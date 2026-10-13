/**
 * EL ARTWORK MANUAL EN EL JUEGO — `npm run card-artwork-client:verify`
 *
 * El bloque anterior dejó demostrado que el SERVIDOR resuelve bien: `card_id` +
 * `minted_version` y nada más. Lo que no había era nadie que lo pintara. Esto verifica lo que
 * faltaba, y lo verifica donde de verdad importa: en un Chrome real, con una sesión real,
 * mirando el DOM que ve el jugador.
 *
 * ────────────────────────── EL MONTAJE ──────────────────────────
 *
 * Una carta con DOS versiones y DOS artworks distintos, y un jugador con tres ejemplares:
 *
 *   · uno acuñado bajo la v1        → tiene que enseñar el artwork A, siempre
 *   · uno acuñado bajo la v2        → tiene que enseñar el artwork B, siempre
 *   · uno de otra carta SIN artwork → tiene que enseñar el dibujado por capas de siempre
 *
 * Los tres a la vez, en la misma pantalla. Es el montaje que hace visible el fallo que se
 * quiere impedir: si la resolución usara «la última versión» o cualquier otra heurística, los
 * dos primeros enseñarían lo mismo y la prueba lo diría.
 *
 * ────────────────────────── QUÉ SE MIRA ──────────────────────────
 *
 * No se comprueba «hay una imagen». Se comprueba QUÉ imagen: cada `<img>` se localiza por su
 * URL exacta, la del fichero que se subió para esa versión concreta. Y se comprueba lo
 * contrario en la misma pantalla: que la URL de la OTRA versión no la sustituye.
 *
 * Lo que crea, lo borra.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { launch, sleep, type Tab } from "./lib/cdp";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
if (!URL_ || !SERVICE || !ANON) { console.error("Falta configuración de Supabase"); process.exit(1); }
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const title = (t: string): void => console.log(`\n─── ${t} ${"─".repeat(Math.max(0, 58 - t.length))}`);

const cuentas: string[] = [];
const cartas: string[] = [];

async function cuenta(esAdmin: boolean) {
  const email = `artcli-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  cuentas.push(data.user.id);
  if (esAdmin) await db.from("profiles").update({ is_admin: true }).eq("id", data.user.id);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`login: ${s.error?.message}`);
  return { id: data.user.id, session: s.data.session, token: s.data.session.access_token };
}

const storageKey = (): string => `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

const post = <T,>(action: string, body: Record<string, unknown>, token: string) =>
  fetch(`${BASE}/api/admin/cards`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...body }), cache: "no-store",
  }).then(async (r) => ({ status: r.status, data: (await r.json().catch(() => ({}))) as T }));

async function subir(cardId: string, version: number, nombre: string, bytes: Buffer, token: string) {
  const fd = new FormData();
  fd.append("action", "artworkUpload");
  fd.append("cardId", cardId);
  fd.append("version", String(version));
  fd.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), nombre);
  const r = await fetch(`${BASE}/api/admin/cards`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd, cache: "no-store",
  });
  return (await r.json().catch(() => ({}))) as { url?: string; cardVersion?: number };
}

/** Un PNG de color plano a la medida real de una carta. Bytes válidos, sin pretensión de arte. */
const png = (r: number, g: number, b: number) =>
  sharp({ create: { width: 750, height: 1050, channels: 3, background: { r, g, b } } }).png().toBuffer();

/** Las URLs de artwork presentes en la pantalla, tal cual las pintó el navegador. */
const imagenes = (tab: Tab) => tab.js<string[]>(
  "(() => [...document.querySelectorAll('img')]" +
  ".map(i => i.currentSrc || i.getAttribute('src') || '')" +
  ".filter(u => u.includes('card_artwork')))()",
);

/** Peticiones que la página ha hecho a la API de cartas. El detector de N+1. */
const peticionesAdmin = (tab: Tab) => tab.js<number>(
  "(() => performance.getEntriesByType('resource')" +
  ".filter(e => e.name.includes('/api/admin/cards')).length)()",
);

async function main(): Promise<void> {
  console.log("\n═══ ARTWORK MANUAL EN EL GAME CLIENT ═══");
  console.log(`  servidor: ${BASE}`);
  const ping = await fetch(`${BASE}/`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) { console.error(`\n  ✕ No hay servidor en ${BASE}.\n`); process.exit(1); }

  const admin = await cuenta(true);
  const jugador = await cuenta(false);

  // ═══════════════════════════════════════════════════════════════════
  title("MONTAJE · UNA CARTA, DOS VERSIONES, DOS ARTWORKS");
  const { data: cands } = await db.from("content_cards").select("player_id, variant_id");
  const por = new Map<string, Set<string>>();
  for (const r of ((cands ?? []) as { player_id: string; variant_id: string }[])) {
    const s = por.get(r.player_id) ?? new Set<string>(); s.add(r.variant_id); por.set(r.player_id, s);
  }
  const libres = [...por.entries()].filter(([, v]) => !v.has("prime")).map(([p]) => p);
  if (libres.length < 2) throw new Error("no hay dos jugadores libres");

  const alta = await post<{ cardId: string }>("create",
    { playerId: libres[0], variantId: "prime", reason: "verificación de artwork en cliente" }, admin.token);
  const CARTA = alta.data.cardId;
  cartas.push(CARTA);
  await post("lifecycle", { cardId: CARTA, state: "PUBLISHED", reason: "publicar" }, admin.token);

  const artA = await subir(CARTA, 1, "v1.png", await png(20, 210, 130), admin.token);
  check("la v1 tiene su artwork", !!artA.url && artA.cardVersion === 1, "artwork A");

  const { data: defRow } = await db.from("content_cards").select("combat").eq("card_id", CARTA).maybeSingle();
  const c = (defRow as { combat: { stronghold: number; gamesense: number; entryfrag: number } }).combat;
  await post("publish", {
    cardId: CARTA, combat: { ...c, stronghold: Math.max(1, c.stronghold - 7) },
    reason: "v2", expectedVersion: 1,
  }, admin.token);
  const artB = await subir(CARTA, 2, "v2.png", await png(220, 40, 90), admin.token);
  check("la v2 tiene OTRO artwork", !!artB.url && artB.cardVersion === 2 && artB.url !== artA.url, "artwork B");

  // Una segunda carta publicada SIN artwork: el control del fallback.
  const alta2 = await post<{ cardId: string }>("create",
    { playerId: libres[1], variantId: "prime", reason: "control sin artwork" }, admin.token);
  const CARTA_SIN = alta2.data.cardId;
  cartas.push(CARTA_SIN);
  await post("lifecycle", { cardId: CARTA_SIN, state: "PUBLISHED", reason: "publicar" }, admin.token);
  check("hay una segunda carta publicada SIN artwork, de control", !!CARTA_SIN, CARTA_SIN);

  const URL_A = String(artA.url), URL_B = String(artB.url);

  /*
   * DOS copias de cada versión, no una.
   *
   * `/inventario` lista los DUPLICADOS —las copias que sobran, no la principal de cada
   * carta—, así que con una copia de cada versión solo saldría una en pantalla. Con dos de
   * cada, el inventario enseña una v1 y una v2 A LA VEZ, que es el montaje que hace visible
   * el cruce entre versiones si lo hubiera.
   */
  const { data: ejemplares } = await db.from("user_cards").insert([
    { user_id: jugador.id, card_id: CARTA, origin: "pack", minted_version: 1 },
    { user_id: jugador.id, card_id: CARTA, origin: "pack", minted_version: 1 },
    { user_id: jugador.id, card_id: CARTA, origin: "pack", minted_version: 2 },
    { user_id: jugador.id, card_id: CARTA, origin: "pack", minted_version: 2 },
    { user_id: jugador.id, card_id: CARTA_SIN, origin: "pack", minted_version: 1 },
  ]).select("uid, card_id, minted_version");
  const filas = (ejemplares ?? []) as { uid: string; card_id: string; minted_version: number }[];
  check("el jugador tiene ejemplares de las dos versiones y uno sin artwork", filas.length === 5,
    filas.map((f) => `v${f.minted_version}`).join(" · "));

  // ═══════════════════════════════════════════════════════════════════
  title("EL CONTRATO DEL SERVIDOR · RESUELTO EN LOTE, NO N+1");
  const estado = await fetch(`${BASE}/api/game/state`, {
    headers: { Authorization: `Bearer ${jugador.token}` }, cache: "no-store",
  }).then((r) => r.json()) as { artworks?: Record<string, { url: string; cardVersion: number }> };
  const mapa = estado.artworks ?? {};
  check("el estado de juego trae el artwork ya resuelto por ejemplar",
    Object.keys(mapa).length === 4, `${Object.keys(mapa).length} ejemplares con artwork`);

  const uidV1 = filas.find((f) => f.card_id === CARTA && f.minted_version === 1)!.uid;
  const uidV2 = filas.find((f) => f.card_id === CARTA && f.minted_version === 2)!.uid;
  const uidSin = filas.find((f) => f.card_id === CARTA_SIN)!.uid;
  check("el ejemplar de la v1 apunta al artwork A", mapa[uidV1]?.url === URL_A, `v${mapa[uidV1]?.cardVersion}`);
  check("el ejemplar de la v2 apunta al artwork B", mapa[uidV2]?.url === URL_B, `v${mapa[uidV2]?.cardVersion}`);
  check("el ejemplar sin artwork NO aparece en el mapa", mapa[uidSin] === undefined, "ausente, no heredado");
  check("y el mapa NO cruza versiones", mapa[uidV1]?.url !== mapa[uidV2]?.url, "dos URLs distintas");

  // ═══════════════════════════════════════════════════════════════════
  const browser = await launch({ width: 1440, height: 900 });
  const tab = browser.tab;
  try {
    await tab.goto(`${BASE}/`, 1500);
    await tab.setStorage(storageKey(), JSON.stringify(jugador.session));

    // ── INVENTARIO ──
    /*
     * Se mira PRIMERO el inventario, y no la colección, porque es donde la prueba es más
     * dura: lista los duplicados uno a uno, así que las dos copias —v1 y v2— salen a la vez
     * en la misma pantalla. Si la resolución fuera por carta en vez de por ejemplar, se
     * vería el mismo fichero dos veces y esto lo cazaría.
     */
    title("INVENTARIO · LAS DOS VERSIONES, A LA VEZ, SIN MEZCLARSE");
    await tab.goto(`${BASE}/inventario`, 6000);
    await sleep(3500);
    const enInv = await imagenes(tab);
    check("el inventario pinta artwork manual", enInv.length > 0, `${enInv.length} imágenes`);
    check("la copia de la v1 enseña el artwork A", enInv.includes(URL_A), "URL exacta de la v1");
    check("la copia de la v2 enseña el artwork B", enInv.includes(URL_B), "URL exacta de la v2");
    check("son dos ficheros distintos en la misma pantalla",
      enInv.includes(URL_A) && enInv.includes(URL_B) && URL_A !== URL_B, "sin cruce de versiones");
    const peticiones = await peticionesAdmin(tab);
    check("sin una petición por carta: el artwork vino con el estado",
      peticiones === 0, `${peticiones} peticiones a /api/admin/cards`);
    const errI = tab.takeErrors();
    check("y sin errores de consola", errI.length === 0, errI.slice(0, 2).join(" | ") || "limpia");

    // ── EL FALLBACK, EN EL NAVEGADOR ──
    /*
     * Se rompe una imagen YA PINTADA y se comprueba que el hueco no se queda vacío: el
     * componente cede el sitio al dibujado por capas. Es la única forma honesta de probar el
     * `onError`, porque un test sin navegador no puede dispararlo.
     */
    title("FALLBACK · CUANDO LA IMAGEN NO CARGA");
    /*
     * El hueco se mide en la REJILLA, no en el `<img>`.
     *
     * Cuando el artwork cede el sitio, el envoltorio que contenía la imagen desaparece del
     * DOM con ella: preguntarle su altura después devuelve 0 aunque la carta esté pintada
     * perfectamente al lado. Lo que hay que afirmar es que la rejilla no se encoge —que el
     * dibujado por capas ocupa el mismo sitio que ocupaba el fichero—, y eso se mide en el
     * contenedor, que sí sigue ahí.
     */
    const trasError = await tab.js<{ antes: number; despues: number; altoAntes: number; altoDespues: number; hijos: number }>(
      "(async () => {" +
      "  const img = [...document.querySelectorAll('img')]" +
      "    .find(i => (i.currentSrc||i.src||'').includes('card_artwork'));" +
      "  if (!img) return { antes: 0, despues: 0, altoAntes: 0, altoDespues: 0, hijos: 0 };" +
      "  const rejilla = img.closest('div.grid') || img.parentElement.parentElement;" +
      "  const antes = document.querySelectorAll('img[src*=\"card_artwork\"]').length;" +
      "  const altoAntes = Math.round(rejilla.getBoundingClientRect().height);" +
      "  const hijos = rejilla.childElementCount;" +
      "  img.src = '/no-existe-' + Date.now() + '.png';" +
      "  await new Promise(r => setTimeout(r, 1500));" +
      "  return {" +
      "    antes," +
      "    despues: document.querySelectorAll('img[src*=\"card_artwork\"]').length," +
      "    altoAntes," +
      "    altoDespues: Math.round(rejilla.getBoundingClientRect().height)," +
      "    hijos: rejilla.childElementCount," +
      "  };" +
      "})()",
    );
    check("una imagen que falla deja de pintarse", trasError.antes > 0 && trasError.despues < trasError.antes,
      `${trasError.antes} → ${trasError.despues}`);
    check("y no deja un hueco: la rejilla no se encoge",
      trasError.altoDespues > 0 && Math.abs(trasError.altoDespues - trasError.altoAntes) <= 4,
      `${trasError.altoAntes} → ${trasError.altoDespues} px`);
    check("la carta sigue siendo una carta, no desaparece", trasError.hijos > 0,
      `${trasError.hijos} cartas en la rejilla`);

    // ── COLECCIÓN ──
    title("COLECCIÓN · CON SUS FILTROS Y SU PAGINACIÓN INTACTOS");
    await tab.goto(`${BASE}/coleccion`, 6000);
    await sleep(3500);
    const col = await tab.js<{ imgs: number; cartas: number; busqueda: boolean }>(
      "(() => ({" +
      "  imgs: document.querySelectorAll('img[src*=\"card_artwork\"]').length," +
      "  cartas: document.querySelectorAll('button').length," +
      // El campo del álbum no declara `type`, así que se localiza por su etiqueta accesible.
      "  busqueda: !!document.querySelector('input[aria-label*=\\\"Buscar\\\"]')," +
      "}))()",
    );
    check("la colección pinta artwork manual", col.imgs > 0, `${col.imgs} imágenes`);
    const enCol = await imagenes(tab);
    check("y es el fichero de la versión del ejemplar que representa la casilla",
      enCol.includes(URL_A) || enCol.includes(URL_B), "URL exacta de un fichero subido");
    check("la rejilla sigue siendo una rejilla de controles", col.cartas > 10, `${col.cartas} controles`);
    check("y la búsqueda sigue ahí", col.busqueda, "campo presente");
    /*
     * Un 404 de recurso no se acepta a ciegas ni se ignora a ciegas: se NOMBRA. Si lo que
     * falta es un artwork, es un fallo de este bloque; si es la foto de un jugador que la
     * carta de prueba no tiene, es el hueco conocido del catálogo y no lo ha traído esto.
     */
    const fallidos = await tab.js<string[]>(
      "(() => performance.getEntriesByType('resource')" +
      ".filter(e => e.responseStatus >= 400).map(e => e.name))()",
    );
    const deArtwork = fallidos.filter((u) => u.includes("card_artwork"));
    check("ningún artwork falla al cargarse", deArtwork.length === 0,
      deArtwork.slice(0, 2).join(" | ") || "todos cargan");
    const errC = tab.takeErrors().filter((e) => !/status of 404/.test(e));
    check("sin errores de consola más allá de los recursos que faltan",
      errC.length === 0, errC.slice(0, 2).join(" | ") || "limpia");
    if (fallidos.length) {
      console.log(`     (recursos 404 ajenos a este bloque: ${fallidos.slice(0, 3).map((u) => u.split("/").pop()).join(", ")})`);
    }

    // ── DUELOS ──
    /*
     * En el duelo el artwork va DEBAJO del cromo, así que lo que hay que afirmar no es solo
     * que aparezca: es que los números con los que se JUEGA siguen ahí encima. Un artwork que
     * tapara el trío de combate no sería un cambio visual, sería un cambio de reglas.
     */
    title("DUELOS · EL ARTE CAMBIA, LOS NÚMEROS NO");
    await tab.goto(`${BASE}/duelos/mazos`, 7000);
    await sleep(3500);
    /*
     * Hay que ABRIR el constructor. La pantalla aterriza en «Mis mazos», que con una cuenta
     * nueva es una invitación vacía: sin entrar en el formulario no se pinta ni una carta, y
     * una comprobación sobre esa pantalla estaría midiendo el vacío y llamándolo aprobado.
     */
    await tab.js(
      "(() => {" +
      "  const b = [...document.querySelectorAll('button')]" +
      "    .find(e => /nuevo (?:mazo|equipo)|crear mi primer (?:mazo|equipo)/i.test(e.textContent || ''));" +
      "  if (b) b.click();" +
      "  return !!b;" +
      "})()",
    );
    await sleep(3500);
    const duelo = await tab.js<{ imgs: number; estadisticas: number; cartas: number; error: string }>(
      "(() => { try {" +
      // Las abreviaturas REALES del trío de combate, las de `STAT_INFO`: SH · GS · EF.
      "  const t = (document.body.innerText || '').match(/\\b(SH|GS|EF)\\b/g) || [];" +
      "  return { imgs: document.querySelectorAll('img[src*=\"card_artwork\"]').length," +
      "           estadisticas: t.length," +
      "           cartas: document.querySelectorAll('[class*=\"aspect-[5/7]\"]').length," +
      "           error: '' };" +
      "} catch (e) { return { imgs: -1, estadisticas: -1, cartas: -1, error: String(e) }; } })()",
    );
    check("el constructor de mazos carga y pinta cartas", duelo.error === "" && duelo.cartas > 0,
      duelo.error || `${duelo.cartas} cartas`);
    check("el duelo pinta el artwork manual del ejemplar", duelo.imgs > 0, `${duelo.imgs} artworks`);
    check("y los números con los que se JUEGA siguen encima del arte", duelo.estadisticas > 0,
      `${duelo.imgs} artworks · ${duelo.estadisticas} etiquetas de estadística`);
    /*
     * Mismo criterio que en la colección: lo que se exige es que no falle NINGÚN artwork. Los
     * 404 de `/players/<id>.png` son el hueco conocido del catálogo —`PlayerPhoto` los espera
     * y dibuja su silueta de reserva— y son anteriores a este bloque, así que se nombran en
     * vez de silenciarse.
     */
    const fallidosD = await tab.js<string[]>(
      "(() => performance.getEntriesByType('resource')" +
      ".filter(e => e.responseStatus >= 400).map(e => e.name))()",
    );
    const artworkRoto = fallidosD.filter((u) => u.includes("card_artwork"));
    check("ningún artwork del duelo falla al cargarse", artworkRoto.length === 0,
      artworkRoto.slice(0, 2).join(" | ") || "todos cargan");
    const errD = tab.takeErrors().filter((e) => !/status of 404/.test(e));
    check("sin errores de consola más allá de los recursos que faltan",
      errD.length === 0, errD.slice(0, 2).join(" | ") || "limpia");
    if (fallidosD.length) {
      console.log(`     (recursos 404 ajenos a este bloque: ${fallidosD.slice(0, 3).map((u) => u.split("/").pop()).join(", ")})`);
    }

    // ── RESPONSIVE ──
    title("RESPONSIVE · 390 · 768 · 1024 · 1440");
    for (const ancho of [390, 768, 1024, 1440]) {
      await tab.resize(ancho, 900);
      await tab.goto(`${BASE}/inventario`, 5000);
      await sleep(2500);
      const r = await tab.js<{ desborde: boolean; proporcion: number; imgs: number }>(
        "(() => {" +
        "  const img = [...document.querySelectorAll('img')]" +
        "    .find(i => (i.currentSrc||i.src||'').includes('card_artwork'));" +
        "  const c = img ? img.getBoundingClientRect() : null;" +
        "  return {" +
        "    desborde: document.documentElement.scrollWidth > window.innerWidth + 1," +
        "    proporcion: c && c.width > 0 ? Math.round((c.height / c.width) * 100) / 100 : 0," +
        "    imgs: document.querySelectorAll('img[src*=\"card_artwork\"]').length," +
        "  };" +
        "})()",
      );
      check(`@${ancho} · sin desbordamiento horizontal`, !r.desborde, r.desborde ? "desborda" : "encaja");
      // 5:7 = 1.4 de alto/ancho. Se admite ±0,05 por el redondeo del layout.
      check(`@${ancho} · la carta conserva su proporción 5:7`,
        r.imgs > 0 && Math.abs(r.proporcion - 1.4) <= 0.05, `alto/ancho ${r.proporcion}`);
    }
  } finally {
    await browser.close();
  }
}

async function limpiar(): Promise<void> {
  const restos: string[] = [];
  for (const id of cuentas) {
    await db.from("user_cards").delete().eq("user_id", id);
    await db.from("user_packs").delete().eq("user_id", id);
  }
  for (const cardId of cartas) {
    const { data: assets } = await db.from("assets").select("storage_path")
      .eq("subject_type", "card").like("subject_id", `${cardId}#v%`);
    const paths = ((assets ?? []) as { storage_path: string | null }[])
      .map((a) => a.storage_path).filter((p): p is string => !!p);
    if (paths.length) {
      const { error } = await db.storage.from("assets").remove(paths);
      if (error) restos.push(`storage: ${error.message}`);
    }
    await db.from("assets").delete().eq("subject_type", "card").like("subject_id", `${cardId}#v%`);
    await db.from("card_mints").delete().eq("card_id", cardId);
    const { error } = await db.rpc("app_content_purge_card", { p_card_id: cardId });
    if (error) restos.push(`purgar ${cardId}: ${error.message}`);
    await db.from("content_audit_log").delete().eq("card_id", cardId);
  }
  await db.rpc("_bump_catalog");
  for (const id of cuentas) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) restos.push(`cuenta ${id}: ${error.message}`);
  }
  const { count: cards } = await db.from("content_cards").select("card_id", { count: "exact", head: true });
  const { count: assets } = await db.from("assets").select("id", { count: "exact", head: true });
  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${cartas.length} cartas · ${cards} definiciones · ${assets} assets`);
  check("no deja filas, ni ficheros, ni assets suyos",
    restos.length === 0 && assets === 0, restos.join(" | ") || `${cards} definiciones · ${assets} assets`);
}

main()
  .catch((e) => { console.error(`\n  ✕ Verificación abortada: ${e}\n`); fail++; })
  .finally(async () => {
    await limpiar().catch((e) => console.error(`  ✕ limpieza: ${e}`));
    console.log(`\n${"─".repeat(62)}`);
    console.log(`  ${pass} correctas · ${fail} fallidas`);
    console.log(fail === 0
      ? "  ✅ CADA EJEMPLAR ENSEÑA LA CARA DE SU VERSIÓN, Y SI NO LA TIENE, LA DE SIEMPRE"
      : "  ❌ LA INTEGRACIÓN DE ARTWORK EN EL CLIENTE TIENE FALLOS");
    process.exit(fail === 0 ? 0 : 1);
  });
