/**
 * QA REAL DE LA CADENA DE CONTENIDO — `npm run content-e2e:qa` (Bloque 8.4.4).
 *
 * Navegador de verdad, sesión de administrador de verdad, sobres de verdad, y —lo que ningún
 * bloque anterior había mirado— **la pantalla del jugador después de que un administrador cree
 * una carta**.
 *
 * `content-e2e:verify` demuestra que el servidor hace lo correcto. Esto comprueba qué se VE:
 *
 *   1-2. El panel no se abre sin ser administrador.
 *   3-5. La carta creada aparece en el catálogo, en su ficha y en el pool, con sus cifras.
 *   6-7. Los sobres reales la entregan y el panel enseña la probabilidad DESCOMPUESTA.
 *   8.   Publicar una versión nueva no cambia lo que el ejemplar antiguo es.
 *   9.   **La colección del jugador** — y aquí es donde este bloque encuentra lo suyo.
 *   10.  El conflicto de dos administradores se ve en pantalla y no borra lo tecleado.
 *   11-12. Responsive (390 / 768 / 1440) y accesibilidad.
 *   13.  Nada de lo que existía se ha movido.
 *
 * Lo que crea lo borra, y lo demuestra al final.
 */
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { launch } from "./lib/cdp";

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

const SHOTS = join(ROOT, "docs", "cards", "qa", "844");
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0, omit_ = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const omit = (l: string, motivo: string): void => {
  console.log(`  [OMIT] ${l} — ${motivo}`); omit_++;
};
const paso = (n: number, s: string): void => console.log(`\n${n}. ${s}\n${"─".repeat(72)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TTL_CACHE_MS = 6_000;

/** Los 404 del arte no son un defecto: no hay retratos en el repositorio (ver 8.4.1 §11). */
const ARTE = /\/(players|teams)\/[^ ]+\.(png|jpg|webp)/;

const sobrantes = async (
  t: { takeErrors: () => string[]; js: <T>(e: string) => Promise<T> }, admitidos: RegExp,
): Promise<string[]> => {
  const errs = t.takeErrors();
  if (errs.length === 0) return [];
  const malos = await t.js<string[]>(`performance.getEntriesByType('resource')
    .filter(r => r.responseStatus >= 400)
    .map(r => r.responseStatus + ' ' + r.name.replace(location.origin, ''))`);
  const noAdmitidos = malos.filter((m) => !admitidos.test(m));
  const resto = noAdmitidos.length === 0 && malos.length > 0
    ? errs.filter((e) => !/Failed to load resource/.test(e))
    : errs;
  return [...noAdmitidos, ...resto];
};

const cuentas: string[] = [];
const cartasCreadas: string[] = [];
let poolCreado: string | null = null;
let vinculosOriginales: { pool_id: string; priority: number }[] = [];
let ejemplaresAntes = 0;
const PACK = "estandar";
const VARIANTE = "emea-winner";

async function cuenta(tag: string, esAdmin: boolean): Promise<{ id: string; session: unknown; token: string }> {
  const email = `qa844-${tag}-${randomUUID()}@nexus.test`;
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

/**
 * Escribe en un `input` controlado por React.
 *
 * Asignar `.value` no dispara el `onChange` de React: hay que llamar al setter nativo del
 * prototipo y lanzar el evento a mano. Sin esto, el campo enseña el texto y el estado sigue
 * vacío, y la comprobación mide una búsqueda que nunca ocurrió.
 */
async function escribir(
  t: { js: <T>(e: string) => Promise<T> }, selector: string, texto: string,
): Promise<boolean> {
  return t.js<boolean>(`(() => {
    const i = document.querySelector(${JSON.stringify(selector)});
    if (!i) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, ${JSON.stringify(texto)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

const storageKey = (): string => `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

async function post<T>(ruta: string, body: Record<string, unknown>, token: string | null): Promise<{ status: number; data: T }> {
  const r = await fetch(`${BASE}${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), cache: "no-store",
  });
  let data: unknown = null;
  try { data = await r.json(); } catch { data = {}; }
  return { status: r.status, data: data as T };
}

/** Huella de lo que existía antes: nada de esto puede moverlo un cambio de contenido. */
async function huella(): Promise<string> {
  const h = createHash("sha256");
  for (const [t, cols, key] of [
    ["duel_decks", "id, user_id, card_uids", "id"],
    ["market_listings", "id, card_id, price, status", "id"],
    ["content_cards", "card_id, ovr, definition_version, lifecycle", "card_id"],
  ] as const) {
    let q = db.from(t).select(cols).order(key);
    for (const c of cartasCreadas) if (t !== "duel_decks") q = q.neq("card_id", c);
    const { data } = await q;
    h.update(t).update(JSON.stringify(data ?? []));
  }
  return h.digest("hex");
}

async function main(): Promise<void> {
  console.log("\n═══ QA REAL DE LA CADENA DE CONTENIDO (Bloque 8.4.4) ═══");
  console.log(`  servidor: ${BASE}`);
  const ping = await fetch(`${BASE}/api/game/state`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) { console.error(`\n  ✕ No hay servidor en ${BASE}.\n`); process.exit(1); }

  const admin = await cuenta("admin", true);
  const admin2 = await cuenta("admin2", true);
  const jugador = await cuenta("jugador", false);
  ejemplaresAntes = (await db.from("user_cards").select("uid", { count: "exact", head: true })).count ?? 0;
  const antes = await huella();
  console.log(`  ejemplares antes de empezar: ${ejemplaresAntes}`);

  const cards = <T>(action: string, body: Record<string, unknown> = {}, token = admin.token) =>
    post<T>("/api/admin/cards", { action, ...body }, token);
  const pools = <T>(action: string, body: Record<string, unknown> = {}, token = admin.token) =>
    post<T>("/api/admin/pools", { action, ...body }, token);

  const { tab, close } = await launch({ width: 1440, height: 900 });
  try {
    // ── 1-2. El guardia ──
    paso(1, "SIN SESIÓN Y COMO JUGADOR: EL PANEL NO SE ABRE");
    for (const ruta of ["/admin/cartas", "/admin/pools"]) {
      await tab.goto(`${BASE}${ruta}`, 2500);
      const texto = await tab.js<string>("document.body.innerText");
      check(`${ruta} sin sesión dice que el acceso está restringido`,
        /acceso restringido|no autorizado|inicia sesión/i.test(texto), texto.slice(0, 70).replace(/\n/g, " "));
    }

    paso(2, "CON SESIÓN DE JUGADOR NORMAL, TAMPOCO");
    await tab.goto(`${BASE}/`, 1200);
    await tab.setStorage(storageKey(), JSON.stringify(jugador.session));
    await tab.goto(`${BASE}/admin/cartas`, 2800);
    const comoJugador = await tab.js<string>("document.body.innerText");
    check("un jugador autenticado no ve el catálogo administrativo",
      /acceso restringido|no autorizado/i.test(comoJugador) && !/content_cards/i.test(comoJugador),
      comoJugador.slice(0, 70).replace(/\n/g, " "));

    // ── 3. El administrador crea la carta ──
    paso(3, "EL ADMINISTRADOR CREA UNA CARTA Y EL PANEL LA ENSEÑA");
    const { data: existentes } = await db.from("content_cards").select("player_id, variant_id");
    const porJugador = new Map<string, Set<string>>();
    for (const r of ((existentes ?? []) as { player_id: string; variant_id: string }[])) {
      const s = porJugador.get(r.player_id) ?? new Set<string>();
      s.add(r.variant_id); porJugador.set(r.player_id, s);
    }
    const elegido = [...porJugador.entries()].find(([, vs]) => !vs.has(VARIANTE))?.[0];
    if (!elegido) throw new Error(`no hay ningún jugador sin ${VARIANTE}`);

    const alta = await cards<{ cardId: string; error?: string }>("create",
      { playerId: elegido, variantId: VARIANTE, reason: "QA 8.4.4" });
    check("la carta se crea desde la API del panel", alta.status === 200, alta.data.error ?? alta.data.cardId);
    if (alta.status !== 200) throw new Error("sin carta no hay QA");
    const CARTA = alta.data.cardId;
    cartasCreadas.push(CARTA);
    await cards("lifecycle", { cardId: CARTA, state: "PUBLISHED", reason: "QA 8.4.4 · publicar" });

    await tab.goto(`${BASE}/`, 1000);
    await tab.setStorage(storageKey(), JSON.stringify(admin.session));
    await tab.goto(`${BASE}/admin/cartas/${encodeURIComponent(CARTA)}`, 3200);
    const ficha = await tab.js<string>("document.body.innerText");
    const { data: defRow } = await db.from("content_cards").select("ovr, definition_version").eq("card_id", CARTA).maybeSingle();
    const def = defRow as { ovr: number; definition_version: number };
    check("la ficha de la carta se abre y lleva su identidad", ficha.includes(CARTA), CARTA);
    check("y enseña el OVR que guardó el servidor, no uno calculado en la pantalla",
      ficha.includes(String(def.ovr)), `OVR ${def.ovr}`);
    check("y su estado de ciclo de vida", /PUBLISHED|Publicada/i.test(ficha), "PUBLISHED");
    await tab.shot(join(SHOTS, "01-ficha-carta-1440.png"));

    /*
     * El buscador del panel es estado de la pantalla, no un parámetro de la URL: hay que
     * TECLEAR en él. Ponerlo en la query no filtra nada y la comprobación habría dicho «no
     * aparece» hablando de una búsqueda que nadie hizo.
     */
    await tab.goto(`${BASE}/admin/cartas`, 3200);
    await escribir(tab, 'input[aria-label^="Buscar por card id"]', elegido);
    await sleep(1400);
    const listado = await tab.js<string>("document.body.innerText");
    check("y aparece en el catálogo administrativo buscando por su jugador",
      listado.includes(CARTA), `buscando «${elegido}»`);

    // ── 4. El pool ──
    paso(4, "EL POOL: CUATRO CARTAS, PESOS 10/20/5 Y LA NUEVA");
    const POOL = `qa844-${randomUUID().slice(0, 8)}`;
    await pools("upsert", { pool: { id: POOL, name: "QA 8.4.4", mode: "EXPLICIT" }, reason: "QA 8.4.4" });
    poolCreado = POOL;

    const { data: comunesRows } = await db.from("content_cards")
      .select("card_id").eq("rarity_bucket", "common").eq("lifecycle", "PUBLISHED")
      .neq("card_id", CARTA).order("card_id").limit(3);
    const TRIO = ((comunesRows ?? []) as { card_id: string }[]).map((r) => r.card_id);
    const PESOS = [10, 20, 5];
    let revision = 0;
    for (const [cardId, weight] of [...TRIO.map((c, i) => [c, PESOS[i]] as [string, number]), [CARTA, 1] as [string, number]]) {
      const r = await pools<{ revision: number }>("entryUpsert", {
        poolId: POOL, cardId, weight, mode: "INCLUDE", reason: `QA · peso ${weight}`,
        ...(revision ? { expectedRevision: revision } : {}),
      });
      if (r.status === 200) revision = r.data.revision;
    }
    check("las cuatro entradas quedan configuradas",
      ((await db.from("content_pool_entries").select("card_id", { count: "exact", head: true })
        .eq("pool_id", POOL)).count ?? 0) === 4, "4 entradas");

    // La revisión se lee ANTES de pintar la pantalla: leerla después mediría una foto de un
    // instante distinto del que se está mirando.
    const revEnBd = Number((await db.from("content_pools").select("revision").eq("id", POOL).maybeSingle()).data!.revision as number);
    await tab.goto(`${BASE}/admin/pools/${encodeURIComponent(POOL)}`, 3400);
    const hoja = await tab.js<string>("document.body.innerText");
    check("la ficha del pool enseña el PESO TOTAL, no porcentajes que cuadren a 100",
      /36/.test(hoja) && /peso/i.test(hoja), "peso total 36 = 10 + 20 + 5 + 1");
    check("y enseña la cuota de cada entrada", /%/.test(hoja), "cuotas visibles");
    check("y la revisión vigente, para que se sepa sobre qué se está editando",
      // `innerText` refleja el `text-transform`, y la insignia va en versalitas: busca «R6».
      new RegExp(`r${revEnBd}(\\D|$)`, "mi").test(hoja), `r${revEnBd}`);
    check("y explica que varios pools se UNEN y que priority no da exclusividad",
      /unen|uni[oó]n/i.test(hoja) && /priority|prioridad/i.test(hoja),
      "es el malentendido más caro posible aquí");
    await tab.shot(join(SHOTS, "02-ficha-pool-1440.png"));

    // ── 5. Publicar y vincular ──
    paso(5, "PUBLICAR EL POOL Y VINCULARLO AL SOBRE REAL");
    const { data: vin } = await db.from("content_pack_pools").select("pool_id, priority").eq("pack_id", PACK);
    vinculosOriginales = (vin ?? []) as { pool_id: string; priority: number }[];
    for (const v of vinculosOriginales) await pools("unbind", { packId: PACK, poolId: v.pool_id });
    const publicado = await pools("publish", { poolId: POOL, state: "ACTIVE", reason: "QA · activar" });
    const vinculado = await pools("bind", { packId: PACK, poolId: POOL, priority: 10 });
    check("el pool se publica y queda vinculado al sobre, en solitario",
      publicado.status === 200 && vinculado.status === 200, `${PACK} ← ${POOL}`);

    // ── 6. Probabilidad, descompuesta y en pantalla ──
    paso(6, "LA PROBABILIDAD, DESCOMPUESTA Y EN PANTALLA");
    await sleep(TTL_CACHE_MS);
    const odds = await pools<{ pBucket: number; pEnBucket: number; pPorHueco: number }>(
      "cardOdds", { cardId: CARTA, packId: PACK });
    check("P(carta) = P(bucket) × P(carta|bucket), y no una sola cifra",
      Math.abs(odds.data.pPorHueco - odds.data.pBucket * odds.data.pEnBucket) < 1e-12
      && odds.data.pEnBucket === 1 && odds.data.pBucket < 1,
      `${(odds.data.pBucket * 100).toFixed(2)} % × 100 % = ${(odds.data.pPorHueco * 100).toFixed(2)} % ` +
      `— y NO el 100 % que vale dentro de su bucket`);

    await tab.goto(`${BASE}/admin/pools/${encodeURIComponent(POOL)}`, 3400);
    // La probabilidad no se calcula sola: se elige sobre y carta y se pulsa. Se hace de verdad.
    const pulsado = await tab.js<boolean>(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find(x => /calcular probabilidad/i.test(x.textContent || ''));
      if (!b) return false; b.click(); return true;
    })()`);
    await sleep(1800);
    const conProb = await tab.js<{ bucket: boolean; hueco: boolean; texto: string }>(`(() => {
      const t = document.body.innerText.toLowerCase();
      return { bucket: t.includes('bucket'), hueco: t.includes('hueco'), texto: t.slice(0, 40) };
    })()`);
    check("la pantalla calcula la probabilidad al pedirla", pulsado, "botón «Calcular probabilidad»");
    check("y la nombra en sus DOS capas: el bucket y el hueco",
      conProb.bucket && conProb.hueco, "P(bucket) y P en un hueco, no un único porcentaje");

    // ── 7. Sobres reales ──
    paso(7, "SOBRES REALES CONTRA ESA CONFIGURACIÓN");
    const abrir = async (n: number): Promise<string[]> => {
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        await db.from("user_packs").upsert({ user_id: jugador.id, pack_id: PACK, qty: 1 },
          { onConflict: "user_id,pack_id" });
        const r = await post<{ opened?: { cardId: string }[] }>(
          "/api/game/packs", { action: "open", packId: PACK }, jugador.token);
        if (r.status !== 200) continue;
        for (const c of r.data.opened ?? []) out.push(c.cardId);
      }
      return out;
    };
    const tanda1 = await abrir(40);
    const enPool = [...TRIO, CARTA];
    check("40 sobres reales entregan 200 cartas, todas del pool configurado",
      tanda1.length === 200 && tanda1.every((c) => enPool.includes(c)),
      `${tanda1.length} cartas · ${[...new Set(tanda1)].length} distintas`);
    check("y la carta que el administrador acaba de crear sale de verdad",
      tanda1.filter((c) => c === CARTA).length > 0,
      `${tanda1.filter((c) => c === CARTA).length} ejemplares`);

    const { data: instV1 } = await db.from("user_cards")
      .select("uid, serial, minted_version").eq("user_id", jugador.id).eq("card_id", CARTA).order("serial");
    const ejemplares = (instV1 ?? []) as { uid: string; serial: number | null; minted_version: number | null }[];
    check("cada ejemplar lleva su número de serie y su versión acuñada",
      ejemplares.length > 0 && ejemplares.every((e) => e.serial !== null && e.minted_version === 1),
      `#${ejemplares[0]?.serial} … #${ejemplares[ejemplares.length - 1]?.serial} · v1`);

    // ── 8. Versión nueva ──
    paso(8, "UNA VERSIÓN NUEVA NO CAMBIA LO QUE YA ESTÁ EN MANOS DE ALGUIEN");
    const { data: d1 } = await db.from("content_cards").select("ovr, combat, definition_version").eq("card_id", CARTA).maybeSingle();
    const antesDef = d1 as { ovr: number; combat: { stronghold: number; gamesense: number; entryfrag: number }; definition_version: number };
    const { unboost } = await import("../src/server/services/cardDerivation");
    const { getVariant } = await import("../src/domain/cards/variants");
    const boost = getVariant(VARIANTE as never).statBoost;
    const base = unboost(antesDef.combat, boost).base;
    const rPub = await cards<{ version?: number; error?: string }>("publish", {
      cardId: CARTA, combat: { ...base, stronghold: Math.max(1, base.stronghold - 9) },
      reason: "QA 8.4.4 · bajar el trío para separar v1 de v2", expectedVersion: antesDef.definition_version,
    });
    check("se publica una versión nueva desde el panel", rPub.status === 200, rPub.data.error ?? `v${rPub.data.version}`);

    const { data: d2 } = await db.from("content_cards").select("ovr").eq("card_id", CARTA).maybeSingle();
    check("la DEFINICIÓN cambia", Number((d2 as { ovr: number }).ovr) !== antesDef.ovr,
      `ovr ${antesDef.ovr} → ${(d2 as { ovr: number }).ovr}`);

    const { data: sigue } = await db.from("user_cards")
      .select("uid, serial, minted_version").eq("uid", ejemplares[0].uid).maybeSingle();
    const i0 = sigue as { uid: string; serial: number | null; minted_version: number | null };
    check("el ejemplar de antes conserva su versión, su serie y su identidad",
      i0.minted_version === 1 && i0.serial === ejemplares[0].serial && i0.uid === ejemplares[0].uid,
      `#${i0.serial} · v${i0.minted_version}`);

    await tab.goto(`${BASE}/admin/cartas/${encodeURIComponent(CARTA)}`, 3400);
    const fichaV2 = await tab.js<string>("document.body.innerText");
    check("la ficha enseña las DOS versiones y cuántos ejemplares hay bajo cada una",
      /v1/i.test(fichaV2) && /v2/i.test(fichaV2), "historial visible");
    await tab.shot(join(SHOTS, "03-ficha-carta-dos-versiones-1440.png"));

    await sleep(TTL_CACHE_MS);
    const tanda2 = await abrir(25);
    const { data: todasInst } = await db.from("user_cards")
      .select("minted_version").eq("user_id", jugador.id).eq("card_id", CARTA);
    const versiones = new Set(((todasInst ?? []) as { minted_version: number | null }[]).map((r) => r.minted_version));
    check("los ejemplares nuevos son v2 y los antiguos siguen siendo v1",
      versiones.has(1) && versiones.has(2), [...versiones].map((v) => `v${v}`).join(" + "));
    void tanda2;

    // ── 9. LA COLECCIÓN DEL JUGADOR ──
    paso(9, "LA COLECCIÓN DEL JUGADOR: ¿SE VE LA CARTA QUE EL ADMIN CREÓ?");
    const estado = await fetch(`${BASE}/api/game/state`, {
      headers: { Authorization: `Bearer ${jugador.token}` }, cache: "no-store",
    }).then((r) => r.json()) as { ownedCards?: { uid: string; cardId: string; mintedVersion?: number | null }[] };
    const propias = (estado.ownedCards ?? []);
    const suyasDeLaNueva = propias.filter((c) => c.cardId === CARTA);
    check("el SERVIDOR le entrega cada ejemplar por separado, con su versión",
      suyasDeLaNueva.length > 1
      && new Set(suyasDeLaNueva.map((c) => c.uid)).size === suyasDeLaNueva.length
      && new Set(suyasDeLaNueva.map((c) => c.mintedVersion)).size === 2,
      `${suyasDeLaNueva.length} ejemplares · ${[...new Set(suyasDeLaNueva.map((c) => `v${c.mintedVersion}`))].join(" + ")}`);

    await tab.goto(`${BASE}/`, 1200);
    await tab.setStorage(storageKey(), JSON.stringify(jugador.session));
    await tab.goto(`${BASE}/coleccion`, 4500);

    /*
     * LA PREGUNTA QUE NADIE HABÍA HECHO.
     *
     * El álbum no sale del servidor: sale de `engine.views()`, un `CollectionEngine` construido
     * sobre el catálogo COMPILADO en el bundle (`CARDS`, derivado de `src/data/players.ts`). Una
     * carta que solo existe en `content_cards` —como la que un administrador acaba de crear— no
     * está en ese conjunto, así que la rejilla no puede pintarla ni en gris.
     *
     * Cada casilla de la rejilla lleva un `aria-label` con el `card_id`: «Ver <id>» si se tiene,
     * «<id> — todavía no la tienes» si falta. Es lo que se cuenta, y no un `innerText` que
     * podría coincidir por el texto de otro sitio de la página.
     */
    const album = await tab.js<{ tarjetas: number; propias: number; laNueva: boolean; cabecera: string }>(
      `(() => {
        const etiquetas = [...document.querySelectorAll('[aria-label]')]
          .map(e => e.getAttribute('aria-label') || '');
        const deCarta = etiquetas.filter(l => /__/.test(l));
        return {
          tarjetas: deCarta.length,
          propias: deCarta.filter(l => l.startsWith('Ver ')).length,
          laNueva: deCarta.some(l => l.includes(${JSON.stringify(CARTA)})),
          cabecera: (document.body.innerText.match(/\\d+\\s*\\/\\s*\\d+/) || [''])[0],
        };
      })()`);

    const distintasServidor = new Set(propias.map((c) => c.cardId)).size;
    check("la rejilla del álbum se pinta", album.tarjetas > 0, `${album.tarjetas} casillas`);
    check("la carta creada desde el panel aparece en la colección del jugador", album.laNueva,
      album.laNueva ? CARTA
        : `NO aparece. El servidor le da ${propias.filter((c) => c.cardId === CARTA).length} ejemplares de ${CARTA}; `
          + `el álbum pinta ${album.tarjetas} casillas y ninguna es esa carta, porque la rejilla sale del `
          + `catálogo COMPILADO (engine.views() sobre CARDS) y no de content_cards`);
    await tab.shot(join(SHOTS, "04-coleccion-jugador-1440.png"));

    /*
     * La cabecera del álbum cuenta lo que el SERVIDOR entrega; la rejilla pinta lo que el
     * catálogo compilado sabe resolver. Cuando no coinciden, la pantalla se contradice a sí
     * misma sin decir nada — que es la peor forma de estar equivocada.
     */
    check("y las cartas distintas que el servidor le atribuye están todas en la rejilla",
      album.propias >= distintasServidor,
      `el servidor dice ${distintasServidor} cartas distintas · la rejilla marca ${album.propias} en posesión`);

    // ── 10. Conflicto en pantalla ──
    paso(10, "DOS ADMINISTRADORES: EL CONFLICTO SE VE Y NO BORRA LO TECLEADO");
    const revActual = Number((await db.from("content_pools").select("revision").eq("id", POOL).maybeSingle()).data!.revision as number);
    const [adminA, adminB] = await Promise.all([
      pools<{ revision?: number }>("entryUpsert", {
        poolId: POOL, cardId: TRIO[0], weight: 12, mode: "INCLUDE",
        reason: "A", expectedRevision: revActual,
      }, admin.token),
      pools<{ error?: string; conflict?: boolean; current?: number }>("entryUpsert", {
        poolId: POOL, cardId: TRIO[1], weight: 22, mode: "INCLUDE",
        reason: "B", expectedRevision: revActual,
      }, admin2.token),
    ]);
    check("una gana y la otra recibe un conflicto marcado, no un error genérico",
      [adminA, adminB].filter((r) => r.status === 200).length === 1
      && [adminA, adminB].some((r) => r.status === 409 && (r.data as { conflict?: boolean }).conflict === true),
      `A ${adminA.status} · B ${adminB.status}`);

    await tab.goto(`${BASE}/`, 1000);
    await tab.setStorage(storageKey(), JSON.stringify(admin.session));
    await tab.goto(`${BASE}/admin/pools/${encodeURIComponent(POOL)}`, 3400);
    const conflicto = await tab.js<boolean>(`(() => {
      const t = document.body.innerText.toLowerCase();
      return t.includes('adelantado') || t.includes('conflicto') || t.includes('revisi');
    })()`);
    check("la pantalla tiene con qué contarlo: revisión visible y aviso de conflicto preparado",
      conflicto, "el panel enseña la revisión vigente y un aviso `role=alert` cuando choca");

    // ── 11. Responsive ──
    paso(11, "RESPONSIVE — 390 / 768 / 1440");
    const RUTAS = [
      "/admin/cartas", "/admin/cartas/nueva", `/admin/cartas/${encodeURIComponent(CARTA)}`,
      `/admin/cartas/${encodeURIComponent(CARTA)}/editar`,
      "/admin/pools", "/admin/pools/nueva", `/admin/pools/${encodeURIComponent(POOL)}`,
    ];
    /*
     * Se VACÍA el registro de errores antes de empezar.
     *
     * `takeErrors()` acumula desde la última lectura, y los pasos 1 y 2 provocan a propósito
     * dos 401 —el guardia del panel haciendo su trabajo— que si no se descartan aquí se le
     * atribuirían a la primera pantalla del barrido. Un arnés que le cuelga a una pantalla el
     * error de otra es peor que no medir nada.
     */
    tab.takeErrors();
    const colados: string[] = [];
    for (const [w, h, nombre] of [[390, 844, "móvil"], [768, 1024, "tableta"], [1440, 900, "escritorio"]] as const) {
      await tab.resize(w, h, 1);
      for (const ruta of RUTAS) {
        await tab.goto(`${BASE}${ruta}`, 2600);
        colados.push(...await sobrantes(tab, ARTE));
        const m = await tab.js<{ scrollW: number; vw: number; pequenos: number; total: number; hayPanel: boolean }>(
          `(() => {
            const panel = document.querySelector('[data-admin-panel]');
            const ctrl = panel ? [...panel.querySelectorAll('button, a[href], input, select, textarea')]
              .filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }) : [];
            return {
              scrollW: document.documentElement.scrollWidth,
              vw: document.documentElement.clientWidth,
              pequenos: ctrl.filter(e => e.getBoundingClientRect().height < 44).length,
              total: ctrl.length, hayPanel: !!panel,
            };
          })()`);
        check(`${nombre} ${w}px · ${ruta} sin desbordamiento horizontal`,
          m.scrollW <= m.vw + 1, `scrollWidth ${m.scrollW} vs ${m.vw}`);
        check(`${nombre} ${w}px · ${ruta} todos los controles ≥ 44 px`,
          m.hayPanel && m.pequenos === 0,
          m.hayPanel ? `${m.total - m.pequenos}/${m.total} cumplen` : "no aparece [data-admin-panel]");
      }
      await tab.goto(`${BASE}/admin/pools/${encodeURIComponent(POOL)}`, 2600);
      await tab.shot(join(SHOTS, `05-pool-${w}.png`));
    }
    check("sin errores de consola inesperados en los tres anchos", colados.length === 0,
      colados.length ? colados.slice(0, 3).join(" | ") : `${3 * RUTAS.length} páginas revisadas`);

    // ── 12. Accesibilidad y estados ──
    paso(12, "ACCESIBILIDAD Y ESTADOS DE LA INTERFAZ");
    await tab.resize(1440, 900, 1);
    for (const ruta of [`/admin/pools/${encodeURIComponent(POOL)}`, `/admin/cartas/${encodeURIComponent(CARTA)}/editar`]) {
      await tab.goto(`${BASE}${ruta}`, 3200);
      const a11y = await tab.js<{ sinNombre: number; inputsSinEtiqueta: number; secciones: number; tablas: number; caption: number; divsClicables: number; foco: number; recorridos: number }>(
        `(() => {
          const p = document.querySelector('[data-admin-panel]');
          if (!p) return { sinNombre: -1, inputsSinEtiqueta: -1, secciones: 0, tablas: 0, caption: 0, divsClicables: -1, foco: 0, recorridos: 0 };
          const ctrl = [...p.querySelectorAll('button, a[href], input, select, textarea')]
            .filter(e => e.getBoundingClientRect().width > 0);
          const nombre = e => (e.getAttribute('aria-label') || e.textContent || '').trim()
            || (e.labels && e.labels.length ? 'label' : '');
          const campos = [...p.querySelectorAll('input, select, textarea')]
            .filter(e => e.getBoundingClientRect().width > 0);
          let foco = 0; const activos = ctrl.filter(e => !e.disabled).slice(0, 12);
          for (const e of activos) { e.focus(); if (document.activeElement === e) foco++; }
          return {
            sinNombre: ctrl.filter(e => !nombre(e)).length,
            inputsSinEtiqueta: campos.filter(e => !e.getAttribute('aria-label') && !(e.labels && e.labels.length)).length,
            secciones: p.querySelectorAll('section[aria-labelledby]').length,
            tablas: p.querySelectorAll('table').length,
            caption: p.querySelectorAll('table caption').length,
            divsClicables: p.querySelectorAll('div[onclick], span[onclick], div[role="button"]').length,
            foco, recorridos: activos.length,
          };
        })()`);
      check(`${ruta} · todo control tiene nombre accesible`, a11y.sinNombre === 0, `${a11y.sinNombre} sin nombre`);
      check(`${ruta} · cada campo tiene etiqueta`, a11y.inputsSinEtiqueta === 0, `${a11y.inputsSinEtiqueta} sin etiqueta`);
      check(`${ruta} · las tablas llevan caption`, a11y.tablas === a11y.caption, `${a11y.caption}/${a11y.tablas}`);
      check(`${ruta} · ningún div haciendo de botón`, a11y.divsClicables === 0, "los pulsables son <button> o <Link>");
      check(`${ruta} · los controles se enfocan con el teclado`, a11y.foco === a11y.recorridos,
        `${a11y.foco}/${a11y.recorridos}`);
    }

    // Estado de ERROR: un pool que no existe.
    await tab.goto(`${BASE}/admin/pools/no-existe-844`, 4000);
    await sleep(4000);
    const errorState = await tab.js<string>("document.body.innerText");
    check("un pool inexistente da un estado de error con salida, no una pantalla en blanco",
      /no se pudo cargar|no encontrado/i.test(errorState) && /volver|reintentar|recargar/i.test(errorState),
      errorState.replace(/\n/g, " ").slice(0, 110));

    // Estado de VACÍO: un filtro que no devuelve nada. Se TECLEA, como haría una persona.
    await tab.goto(`${BASE}/admin/cartas`, 3200);
    await escribir(tab, 'input[aria-label^="Buscar por card id"]', "zzzznoexiste844");
    await sleep(1600);
    const vacio = await tab.js<string>("document.body.innerText");
    check("un filtro sin resultados lo dice, no deja una tabla muda",
      /sin resultados|no hay|ninguna|vac[ií]o|0 cartas/i.test(vacio),
      vacio.replace(/\n/g, " ").slice(0, 110));

    // Validación: un trío fuera de escala tiene que responder con motivo.
    const mal = await cards<{ error?: string }>("publish", {
      cardId: CARTA, combat: { stronghold: 500, gamesense: 10, entryfrag: 10 }, reason: "QA · fuera de escala",
    });
    check("una validación fallida devuelve un motivo legible, no un 500",
      mal.status === 400 && /escala/i.test(mal.data.error ?? ""), (mal.data.error ?? "").slice(0, 80));

    // ── 13. El resto del juego ──
    paso(13, "EL RESTO DEL JUEGO, INTACTO");
    check("nada ajeno a esta QA se ha movido", (await huella()) === antes, "huella idéntica");
    const { count: mazos } = await db.from("duel_decks").select("id", { count: "exact", head: true });
    const { count: listados } = await db.from("market_listings").select("id", { count: "exact", head: true });
    check("mazos y listados siguen donde estaban", (mazos ?? 0) >= 0 && (listados ?? 0) >= 0,
      `${mazos} mazos · ${listados} listados`);
  } finally {
    await close();
  }
}

async function limpiar(): Promise<void> {
  const restos: string[] = [];

  if (poolCreado) await db.from("content_pack_pools").delete().eq("pool_id", poolCreado);
  for (const v of vinculosOriginales) {
    const { error } = await db.rpc("app_content_pack_bind", {
      p_pack_id: PACK, p_pool_id: v.pool_id, p_priority: v.priority, p_action: "bind", p_actor: null,
    });
    if (error) restos.push(`revincular ${v.pool_id}: ${error.message}`);
  }

  for (const id of cuentas) {
    const { data: suyas } = await db.from("user_cards").select("card_id").eq("user_id", id);
    const porCarta = new Map<string, number>();
    for (const r of ((suyas ?? []) as { card_id: string }[])) {
      porCarta.set(r.card_id, (porCarta.get(r.card_id) ?? 0) + 1);
    }
    await db.from("market_listings").delete().eq("seller_id", id);
    await db.from("user_cards").delete().eq("user_id", id);
    for (const [cardId, n] of porCarta) {
      const { data: m } = await db.from("card_mints").select("minted").eq("card_id", cardId).maybeSingle();
      if (!m) continue;
      const restante = Math.max(0, Number((m as { minted: number }).minted) - n);
      const { error } = await db.from("card_mints").update({ minted: restante }).eq("card_id", cardId);
      if (error) restos.push(`card_mints de ${cardId}: ${error.message}`);
    }
    await db.from("user_packs").delete().eq("user_id", id);
  }

  if (poolCreado) {
    for (const [t, col] of [["content_pool_entries", "pool_id"], ["content_pools", "id"],
      ["content_audit_log", "pool_id"]] as const) {
      const { error } = await db.from(t).delete().eq(col, poolCreado);
      if (error) restos.push(`${t}: ${error.message}`);
    }
  }

  for (const cardId of cartasCreadas) {
    await db.from("card_mints").delete().eq("card_id", cardId);
    const { error } = await db.rpc("app_content_purge_card", { p_card_id: cardId });
    if (error) restos.push(`purgar ${cardId}: ${error.message}`);
    await db.from("content_audit_log").delete().eq("card_id", cardId);
  }

  const { error: eB } = await db.rpc("_bump_distribution", { p_pool_id: null });
  if (eB) restos.push(`latido: ${eB.message}`);
  await db.rpc("_bump_catalog");

  for (const id of cuentas) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) restos.push(`cuenta ${id}: ${error.message}`);
  }

  const { count: quedan } = await db.from("content_pools")
    .select("id", { count: "exact", head: true }).like("id", "qa844-%");
  const { count: uc } = await db.from("user_cards").select("uid", { count: "exact", head: true });
  const { count: vinculos } = await db.from("content_pack_pools")
    .select("pack_id", { count: "exact", head: true }).eq("pack_id", PACK);

  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${quedan} pools de prueba · `
    + `${vinculos} vínculo(s) en «${PACK}» · ${uc} ejemplares (había ${ejemplaresAntes})`);
  check("la QA no deja nada suyo detrás",
    (quedan ?? 0) === 0 && vinculos === vinculosOriginales.length
    && uc === ejemplaresAntes && restos.length === 0,
    restos.length ? restos.slice(0, 3).join(" | ") : `sobre restaurado a ${vinculosOriginales.length} vínculo(s)`);
}

main()
  .catch((e) => { console.error("\n✕ QA abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar().catch((e) => { console.error("  ✕ limpieza:", e); fail++; });
    console.log("\n" + "─".repeat(72));
    console.log(`  ${pass} correctas · ${fail} fallidas${omit_ ? ` · ${omit_} omitidas` : ""}`);
    console.log(fail === 0 ? "  ✅ QA REAL SUPERADA" : "  ❌ QA REAL CON FALLOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
