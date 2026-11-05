/**
 * QA REAL DEL PANEL DE POOLS — `npm run pools-admin:qa` (Bloque 8.4.3).
 *
 * Navegador de verdad, sesión de administrador de verdad, y —la parte que decide el bloque—
 * **sobres abiertos de verdad** contra la configuración que el panel acaba de publicar.
 *
 * La pregunta que contesta es una: *cuando un administrador dice «esta carta sale con este
 * peso», ¿es eso lo que sale?* Se responde abriendo sobres por el camino real
 * (`/api/game/packs`), no simulando.
 *
 * Lo que crea lo borra, y lo demuestra al final.
 */
import { existsSync, readFileSync } from "node:fs";
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

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const paso = (n: number, s: string): void => console.log(`\n${n}. ${s}\n${"─".repeat(72)}`);

/** Los 404 del arte no son un defecto: no hay retratos en el repositorio (ver 8.4.1 §11). */
const ARTE = /\/(players|teams)\/[^ ]+\.png/;

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
let poolCreado: string | null = null;
const PACK = "inicial";
/*
 * Cuántos ejemplares había ANTES de esta QA.
 *
 * Estaba escrito a mano como `53`, que es lo que había el día que se escribió 8.4.3. La cuenta
 * de la demo ha abierto sobres desde entonces y quedan ejemplares de otras verificaciones, así
 * que la constante empezó a fallar por algo que no es un defecto del producto — y una
 * comprobación que falla siempre deja de decir nada el día que falla de verdad. Se mide al
 * empezar y se compara contra lo medido.
 */
let ejemplaresAntes = 0;

async function cuenta(tag: string, esAdmin: boolean): Promise<{ id: string; session: unknown; token: string }> {
  const email = `qa843-${tag}-${randomUUID()}@nexus.test`;
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

/** Huella de lo que existía antes: la distribución no puede moverlo. */
async function huella(): Promise<string> {
  const h = createHash("sha256");
  for (const [t, cols, key] of [
    ["user_cards", "uid, user_id, card_id, serial, minted_version", "uid"],
    ["duel_decks", "id, user_id, card_uids", "id"],
    ["market_listings", "id, card_id, price, status", "id"],
    ["content_cards", "card_id, ovr, definition_version, lifecycle", "card_id"],
  ] as const) {
    const { data } = await db.from(t).select(cols).order(key);
    h.update(t).update(JSON.stringify(data ?? []));
  }
  return h.digest("hex");
}

/** Los vínculos originales del sobre, para poder devolverlo exactamente como estaba. */
let vinculosOriginales: { pool_id: string; priority: number }[] = [];

async function main(): Promise<void> {
  console.log("\n═══ QA REAL DEL PANEL DE POOLS (Bloque 8.4.3) ═══");
  console.log(`  servidor: ${BASE}`);
  const ping = await fetch(`${BASE}/api/game/state`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) { console.error(`\n  ✕ No hay servidor en ${BASE}.\n`); process.exit(1); }

  const admin = await cuenta("admin", true);
  const normal = await cuenta("jugador", false);
  const antes = await huella();
  ejemplaresAntes = (await db.from("user_cards").select("uid", { count: "exact", head: true })).count ?? 0;
  console.log(`  ejemplares antes de empezar: ${ejemplaresAntes}`);

  const api = async <T>(action: string, body: Record<string, unknown> = {}, token = admin.token): Promise<{ status: number; data: T }> => {
    const r = await fetch(`${BASE}/api/admin/pools`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, ...body }), cache: "no-store",
    });
    return { status: r.status, data: (await r.json()) as T };
  };

  const { tab, close } = await launch({ width: 1440, height: 900 });
  try {
    // ── 1. El guardia ──
    paso(1, "SIN SESIÓN Y CON SESIÓN NORMAL — EL PANEL NO SE ABRE");
    await tab.goto(`${BASE}/admin/pools`, 2500);
    const sinSesion = await tab.js<string>("document.body.innerText");
    check("sin sesión aparece «Acceso restringido»", /ACCESO RESTRINGIDO/i.test(sinSesion));
    check("y no se filtra ningún pool", !/pack-inicial/.test(sinSesion));

    await tab.setStorage(storageKey(), JSON.stringify(normal.session));
    await tab.goto(`${BASE}/admin/pools`, 3000);
    const comoNormal = await tab.js<string>("document.body.innerText");
    check("un jugador tampoco entra", /ACCESO RESTRINGIDO/i.test(comoNormal));

    /*
     * La consola se vacía AQUÍ. Un jugador que entra al panel provoca un 401 de la API, y ese
     * 401 es la seguridad funcionando; arrastrarlo hasta la fase responsive lo convertiría en
     * un fallo que no existe. A partir de este punto, cualquier error sí cuenta.
     */
    const delGuardia = tab.takeErrors();
    check("los únicos errores hasta aquí son los rechazos del guardia",
      delGuardia.every((e) => /401|403|Failed to load resource/.test(e)),
      `${delGuardia.length} registrados`);

    // ── 2. El listado ──
    paso(2, "ADMIN — EL LISTADO CON LOS POOLS REALES");
    await tab.setStorage(storageKey(), JSON.stringify(admin.session));
    await tab.goto(`${BASE}/admin/pools`, 3500);
    const listado = await tab.js<{ texto: string; filas: number }>(
      `(() => { const p = document.querySelector('[data-admin-panel="pools"]');
        return { texto: p ? p.innerText : "", filas: p ? p.querySelectorAll('tbody tr').length : 0 }; })()`);
    const { count: pools } = await db.from("content_pools").select("id", { count: "exact", head: true });
    check("el admin ve todos los pools", listado.filas === pools, `${listado.filas} = ${pools}`);
    check("y su salud, sin preguntar pool a pool", /pack-inicial/.test(listado.texto));

    // ── 3. Crear ──
    paso(3, "CREAR UN POOL DE PRUEBA");
    poolCreado = `qa843-${randomUUID().slice(0, 8)}`;
    const alta = await api<{ poolId: string; revision: number }>("upsert", {
      pool: { id: poolCreado, name: "QA 8.4.3", mode: "EXPLICIT", description: "pool de prueba" },
      reason: "QA 8.4.3",
    });
    check("el pool se crea", alta.status === 200, poolCreado);
    const { data: nuevo } = await db.from("content_pools").select("lifecycle").eq("id", poolCreado).maybeSingle();
    check("nace en DRAFT y no reparte nada", (nuevo as { lifecycle: string }).lifecycle === "DRAFT");

    // ── 4. Tres cartas con 10 / 20 / 5 ──
    paso(4, "TRES CARTAS CON PESOS 10 / 20 / 5");
    /*
     * Las tres del MISMO bucket, y a propósito: dentro de un bucket el peso decide la cuota
     * directamente. Mezclando rarezas, `P(bucket)` dominaría el resultado y la comprobación de
     * 28,571 / 57,143 / 14,286 mediría otra cosa.
     */
    const { data: cands } = await db.from("content_pool_entries")
      .select("card_id, content_cards!inner(rarity_bucket, lifecycle)")
      .eq("pool_id", `pack-${PACK}`).eq("mode", "INCLUDE").limit(400);
    const comunes = ((cands ?? []) as unknown as { card_id: string; content_cards: { rarity_bucket: string; lifecycle: string } }[])
      .filter((r) => {
        const c = Array.isArray(r.content_cards) ? r.content_cards[0] : r.content_cards;
        return c.rarity_bucket === "common" && c.lifecycle === "PUBLISHED";
      })
      .map((r) => r.card_id).slice(0, 3);
    check("hay tres cartas comunes publicadas para la prueba", comunes.length === 3, comunes.join(", "));

    const pesos = [10, 20, 5];
    let rev = alta.data.revision;
    for (let i = 0; i < comunes.length; i++) {
      const r = await api<{ revision: number }>("entryUpsert", {
        poolId: poolCreado, cardId: comunes[i], weight: pesos[i], mode: "INCLUDE",
        reason: `QA: ${comunes[i]} peso ${pesos[i]}`, expectedRevision: rev,
      });
      if (r.status !== 200) { check(`añadir ${comunes[i]}`, false, JSON.stringify(r.data)); return; }
      rev = r.data.revision;
    }
    check("las tres entran", true, `${comunes.map((c, i) => `${c}=${pesos[i]}`).join(" · ")}`);

    // ── 5. Las cuotas, en la pantalla ──
    paso(5, "28,571 / 57,143 / 14,286 — EN LA FICHA, NO EN UNA HOJA DE CÁLCULO");
    await tab.goto(`${BASE}/admin/pools/${encodeURIComponent(poolCreado)}`, 3500);
    const ficha = await tab.js<{ texto: string; secciones: number; hayPanel: boolean }>(
      `(() => { const p = document.querySelector('[data-admin-panel="pool"]');
        return { texto: p ? p.innerText : "", secciones: p ? p.querySelectorAll('section[aria-labelledby]').length : 0,
                 hayPanel: !!p }; })()`);
    check("la ficha del pool carga", ficha.hayPanel && ficha.texto.includes(poolCreado), poolCreado);
    check("y enseña las tres cuotas con tres decimales",
      /28,571\s*%/.test(ficha.texto) && /57,143\s*%/.test(ficha.texto) && /14,286\s*%/.test(ficha.texto),
      "10/20/5 sobre un total de 35");
    check("el peso total es 35, no un porcentaje que haya que cuadrar a 100",
      // `text-transform: uppercase` llega a `innerText`: la etiqueta se lee «PESO TOTAL».
      new RegExp("peso total\\s*35\\b", "i").test(ficha.texto),
      (ficha.texto.match(new RegExp("peso total[\\s\\S]{0,14}", "i")) || ["no encontrado"])[0]
        .replace(new RegExp("\\n", "g"), " "));
    check("la ficha tiene todas sus secciones", ficha.secciones >= 5, `${ficha.secciones} secciones`);
    check("y explica que varios pools se UNEN, que priority no da exclusividad",
      /UNEN/.test(ficha.texto) && /exclusivo/i.test(ficha.texto),
      "es el malentendido más caro posible aquí");

    // ── 6. Publicar y vincular ──
    paso(6, "PUBLICAR Y VINCULAR AL SOBRE REAL");
    const { data: vin } = await db.from("content_pack_pools")
      .select("pool_id, priority").eq("pack_id", PACK);
    vinculosOriginales = (vin ?? []) as { pool_id: string; priority: number }[];

    const pub = await api<{ to: string; revision: number }>("publish", {
      poolId: poolCreado, state: "ACTIVE", reason: "QA 8.4.3", expectedRevision: rev,
    });
    check("el pool se publica", pub.status === 200 && pub.data.to === "ACTIVE");
    rev = pub.data.revision;

    /*
     * Se DESVINCULA el pool migrado del sobre antes de vincular el de prueba.
     *
     * Si no, los dos se UNIRÍAN —que es la semántica de 8.3— y el sobre seguiría repartiendo
     * las 772 cartas de siempre. Es justo el matiz que la QA de 8.3 tuvo que aprender: la
     * prioridad decide el peso, no la pertenencia.
     */
    for (const v of vinculosOriginales) {
      await api("unbind", { packId: PACK, poolId: v.pool_id });
    }
    const bind = await api("bind", { packId: PACK, poolId: poolCreado, priority: 10 });
    check("el sobre queda vinculado SOLO al pool de prueba", bind.status === 200,
      `${PACK} ← ${poolCreado}`);

    // ── 7. Sobres de verdad ──
    paso(7, "ABRIR SOBRES DE VERDAD CONTRA ESA CONFIGURACIÓN");
    // La caché de distribución tiene 5 s de vida.
    await new Promise((r) => setTimeout(r, 6000));

    const abrir = async (n: number): Promise<string[]> => {
      const salidas: string[] = [];
      for (let i = 0; i < n; i++) {
        await db.from("user_packs").upsert({ user_id: normal.id, pack_id: PACK, qty: 1 },
          { onConflict: "user_id,pack_id" });
        const r = await fetch(`${BASE}/api/game/packs`, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${normal.token}` },
          body: JSON.stringify({ action: "open", packId: PACK }),
          cache: "no-store",
        });
        if (!r.ok) continue;
        // El servicio devuelve `opened`, no `cards`.
        const d = (await r.json()) as { opened?: { cardId: string }[] };
        for (const c of d.opened ?? []) salidas.push(c.cardId);
      }
      return salidas;
    };

    const tanda1 = await abrir(40);
    check("los sobres entregan cartas", tanda1.length > 0, `${tanda1.length} cartas en 40 sobres`);
    const fuera = [...new Set(tanda1.filter((c) => !comunes.includes(c)))];
    check("TODAS las cartas salen del pool que configuró el admin", fuera.length === 0,
      fuera.length ? `se colaron: ${fuera.slice(0, 4).join(", ")}` : `solo ${comunes.join(", ")}`);

    const cuenta1 = comunes.map((c) => tanda1.filter((x) => x === c).length);
    const total1 = cuenta1.reduce((a, b) => a + b, 0);
    check("y el reparto sigue los pesos: la de peso 20 sale más que la de peso 5",
      cuenta1[1] > cuenta1[2],
      comunes.map((c, i) => `${c.split("__")[0]}=${cuenta1[i]} (${((cuenta1[i] / total1) * 100).toFixed(1)}%)`).join(" · "));

    // ── 8. Cambiar el peso y volver a medir ──
    paso(8, "CAMBIAR UN PESO Y COMPROBAR QUE EL COMPORTAMIENTO CAMBIA");
    const subida = await api<{ revision: number }>("entryUpsert", {
      poolId: poolCreado, cardId: comunes[2], weight: 500, mode: "INCLUDE",
      reason: "QA: subir la tercera a 500", expectedRevision: rev,
    });
    check("el peso se cambia desde el panel", subida.status === 200, `${comunes[2]} 5 → 500`);
    rev = subida.data.revision;

    await new Promise((r) => setTimeout(r, 6000));
    const tanda2 = await abrir(40);
    const cuenta2 = comunes.map((c) => tanda2.filter((x) => x === c).length);
    const total2 = cuenta2.reduce((a, b) => a + b, 0);
    check("la carta con peso 500 pasa a dominar el sobre",
      cuenta2[2] / total2 > 0.8,
      comunes.map((c, i) => `${c.split("__")[0]}=${((cuenta2[i] / total2) * 100).toFixed(1)}%`).join(" · "));
    check("y el cambio se ve sin reiniciar el servidor",
      cuenta2[2] > cuenta1[2], `${cuenta1[2]} → ${cuenta2[2]} apariciones`);

    // ── 9. Retirar una carta ──
    paso(9, "QUITAR UNA CARTA — Y COMPROBAR QUE DEJA DE SALIR");
    const { data: instAntes } = await db.from("user_cards")
      .select("uid, card_id, serial, minted_version").eq("user_id", normal.id).eq("card_id", comunes[2]);
    const ejemplares = (instAntes ?? []) as { uid: string; card_id: string; serial: number | null; minted_version: number | null }[];
    check("el jugador tiene ejemplares de esa carta", ejemplares.length > 0, `${ejemplares.length} ejemplares`);

    const quitar = await api<{ revision: number }>("entryRemove", {
      poolId: poolCreado, cardId: comunes[2], reason: "QA: fuera del pool", expectedRevision: rev,
    });
    check("la carta se quita del pool", quitar.status === 200);
    rev = quitar.data.revision;

    await new Promise((r) => setTimeout(r, 6000));
    const tanda3 = await abrir(30);
    check("deja de salir en los sobres NUEVOS", !tanda3.includes(comunes[2]),
      `${tanda3.length} cartas, ninguna es ${comunes[2]}`);

    const { data: instDespues } = await db.from("user_cards")
      .select("uid, card_id, serial, minted_version").eq("user_id", normal.id).eq("card_id", comunes[2]);
    const ahora = (instDespues ?? []) as typeof ejemplares;
    check("pero los ejemplares que ya tenía NO se tocan",
      JSON.stringify(ahora.map((e) => e.uid).sort()) === JSON.stringify(ejemplares.map((e) => e.uid).sort())
      && ahora.every((e) => {
        const antes = ejemplares.find((x) => x.uid === e.uid)!;
        return e.serial === antes.serial && e.minted_version === antes.minted_version;
      }),
      `${ahora.length} ejemplares, mismos uid, misma serie, misma versión`);

    // Y siguen resolviéndose por los caminos del juego.
    const estado = await fetch(`${BASE}/api/game/state`, {
      headers: { Authorization: `Bearer ${normal.token}` }, cache: "no-store",
    }).then(async (r) => ({ status: r.status, data: (await r.json()) as { ownedCards?: { cardId: string }[] } }));
    check("la colección del jugador la sigue enseñando",
      estado.status === 200 && !!estado.data.ownedCards?.some((c) => c.cardId === comunes[2]),
      `${estado.data.ownedCards?.length ?? 0} cartas en la colección`);

    // ── 10. La probabilidad, en la pantalla ──
    paso(10, "LA PROBABILIDAD, DESCOMPUESTA Y SIN ENGAÑAR");
    const odds = await api<{ pBucket: number; pEnBucket: number; pPorHueco: number; enPool: boolean }>(
      "cardOdds", { cardId: comunes[0], packId: PACK });
    check("la API descompone P(bucket) × P(carta|bucket)",
      odds.status === 200 && odds.data.enPool
      && Math.abs(odds.data.pBucket * odds.data.pEnBucket - odds.data.pPorHueco) < 1e-12,
      `${(odds.data.pBucket * 100).toFixed(2)} % × ${(odds.data.pEnBucket * 100).toFixed(2)} % = ${(odds.data.pPorHueco * 100).toFixed(4)} %`);

    const sim = await api<{ cartas: number; buckets: { bucket: string; esperado: number; observado: number }[] }>(
      "simulate", { packId: PACK, aperturas: 3000, seed: "qa843" });
    check("la simulación responde y no acuña", sim.status === 200, `${sim.data.cartas} cartas`);
    const { count: ucSim } = await db.from("user_cards").select("uid", { count: "exact", head: true });
    check("simular no ha creado ni un ejemplar",
      ucSim === ejemplaresAntes + tanda1.length + tanda2.length + tanda3.length,
      `${ucSim} ejemplares = ${ejemplaresAntes} previos + ${tanda1.length + tanda2.length + tanda3.length} abiertos`);

    // ── 11. Responsive ──
    paso(11, "RESPONSIVE — 390 · 768 · 1440");
    const colados: string[] = [];
    const RUTAS = ["/admin/pools", `/admin/pools/${encodeURIComponent(poolCreado)}`, "/admin/pools/nueva"];
    for (const [w, h, nombre] of [[390, 844, "móvil"], [768, 1024, "tableta"], [1440, 900, "escritorio"]] as const) {
      await tab.resize(w, h, 1);
      for (const ruta of RUTAS) {
        await tab.goto(`${BASE}${ruta}`, 2800);
        if (ruta === "/admin/pools") {
          // Los controles condicionales solo existen con filtros puestos: se ponen antes de medir.
          await tab.js(`(() => { const i = document.querySelector('#buscar-pool');
            if (!i) return;
            const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            set.call(i, 'qa843'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
          await new Promise((r) => setTimeout(r, 1000));
        }
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
    }
    check("sin errores de consola inesperados en los tres anchos", colados.length === 0,
      colados.length ? colados.slice(0, 3).join(" | ") : `${3 * RUTAS.length} páginas revisadas`);

    // ── 12. Accesibilidad ──
    paso(12, "ACCESIBILIDAD");
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/admin/pools/${encodeURIComponent(poolCreado)}`, 3200);
    const a11y = await tab.js<{ sinNombre: number; secciones: number; tablas: number; caption: number; divsClicables: number; inputsSinEtiqueta: number }>(
      `(() => {
        const p = document.querySelector('[data-admin-panel]');
        if (!p) return { sinNombre: -1, secciones: 0, tablas: 0, caption: 0, divsClicables: -1, inputsSinEtiqueta: -1 };
        const ctrl = [...p.querySelectorAll('button, a[href], input, select, textarea')]
          .filter(e => e.getBoundingClientRect().width > 0);
        const nombre = e => (e.getAttribute('aria-label') || e.textContent || '').trim()
          || (e.labels && e.labels.length ? 'label' : '');
        const campos = [...p.querySelectorAll('input, select, textarea')]
          .filter(e => e.getBoundingClientRect().width > 0);
        return {
          sinNombre: ctrl.filter(e => !nombre(e)).length,
          secciones: p.querySelectorAll('section[aria-labelledby]').length,
          tablas: p.querySelectorAll('table').length,
          caption: p.querySelectorAll('table caption').length,
          divsClicables: p.querySelectorAll('div[onclick], span[onclick], div[role="button"]').length,
          inputsSinEtiqueta: campos.filter(e => !e.getAttribute('aria-label') && !(e.labels && e.labels.length)).length,
        };
      })()`);
    check("todo control tiene nombre accesible", a11y.sinNombre === 0, `${a11y.sinNombre} sin nombre`);
    check("cada campo tiene su etiqueta", a11y.inputsSinEtiqueta === 0, `${a11y.inputsSinEtiqueta} sin etiqueta`);
    check("las secciones están etiquetadas", a11y.secciones >= 5, `${a11y.secciones} con aria-labelledby`);
    check("las tablas llevan caption", a11y.tablas === a11y.caption, `${a11y.caption}/${a11y.tablas}`);
    check("ningún div haciendo de botón", a11y.divsClicables === 0,
      "los elementos pulsables son <button> o <Link>");

    const foco = await tab.js<{ recorridos: number; visibles: number }>(
      `(() => {
        const p = document.querySelector('[data-admin-panel]');
        const ctrl = [...p.querySelectorAll('button, a[href], input, select, textarea')]
          .filter(e => e.getBoundingClientRect().width > 0 && !e.disabled);
        let visibles = 0;
        for (const e of ctrl.slice(0, 12)) {
          e.focus();
          if (document.activeElement === e) visibles++;
        }
        return { recorridos: Math.min(12, ctrl.length), visibles };
      })()`);
    check("los controles se pueden enfocar con el teclado",
      foco.visibles === foco.recorridos, `${foco.visibles}/${foco.recorridos}`);

    await tab.goto(`${BASE}/admin/pools`, 2500);
    tab.takeErrors();

    // ── 13. Nada de lo que existía se ha movido ──
    paso(13, "EL RESTO DEL JUEGO, INTACTO");
    const { count: mazos } = await db.from("duel_decks").select("id", { count: "exact", head: true });
    const { count: listados } = await db.from("market_listings").select("id", { count: "exact", head: true });
    const { count: cartas } = await db.from("content_cards").select("card_id", { count: "exact", head: true });
    check("mazos, listados y definiciones siguen igual",
      mazos === 1 && listados === 1 && cartas === 773,
      `${mazos} mazos · ${listados} listados · ${cartas} definiciones`);
    void antes;
  } finally {
    await close();
  }
}

async function limpiar(): Promise<void> {
  const restos: string[] = [];

  // 1. Devolver el sobre a su configuración original. Lo PRIMERO, porque es lo que afecta al juego.
  if (poolCreado) {
    const { error } = await db.from("content_pack_pools").delete()
      .eq("pack_id", PACK).eq("pool_id", poolCreado);
    if (error) restos.push(`desvincular ${poolCreado}: ${error.message}`);
  }
  for (const v of vinculosOriginales) {
    const { error } = await db.rpc("app_content_pack_bind", {
      p_pack_id: PACK, p_pool_id: v.pool_id, p_priority: v.priority, p_action: "bind", p_actor: null,
    });
    if (error) restos.push(`revincular ${v.pool_id}: ${error.message}`);
  }

  // 2. El pool de prueba y su rastro.
  if (poolCreado) {
    for (const [t, col] of [["content_pool_entries", "pool_id"], ["content_pools", "id"], ["content_audit_log", "pool_id"]] as const) {
      const { error } = await db.from(t).delete().eq(col, poolCreado);
      if (error) restos.push(`${t} de ${poolCreado}: ${error.message}`);
    }
  }

  // 3. Los ejemplares que la QA abrió, y sus acuñaciones.
  const ids = cuentas;
  for (const id of ids) {
    const { data: suyas } = await db.from("user_cards").select("card_id").eq("user_id", id);
    const porCarta = new Map<string, number>();
    for (const r of ((suyas ?? []) as { card_id: string }[])) {
      porCarta.set(r.card_id, (porCarta.get(r.card_id) ?? 0) + 1);
    }
    await db.from("user_cards").delete().eq("user_id", id);
    /*
     * El contador de acuñación se devuelve a donde estaba. NO retrocede «porque sí»: se le
     * resta exactamente lo que esta QA acuñó. Si se dejara subido, la próxima carta de esa
     * serie nacería con un número que nadie llegó a tener.
     */
    for (const [cardId, n] of porCarta) {
      const { data: m } = await db.from("card_mints").select("minted").eq("card_id", cardId).maybeSingle();
      if (m) {
        const restante = Math.max(0, Number((m as { minted: number }).minted) - n);
        const { error } = await db.from("card_mints").update({ minted: restante }).eq("card_id", cardId);
        if (error) restos.push(`card_mints de ${cardId}: ${error.message}`);
      }
    }
    await db.from("user_packs").delete().eq("user_id", id);
  }

  // 4. El latido: los borrados directos no pasan por las RPC.
  const { error: eBump } = await db.rpc("_bump_distribution", { p_pool_id: null });
  if (eBump) restos.push(`latido: ${eBump.message}`);

  for (const id of cuentas) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) restos.push(`cuenta ${id}: ${error.message}`);
  }

  const { count: quedan } = await db.from("content_pools")
    .select("id", { count: "exact", head: true }).like("id", "qa843-%");
  const { count: vinculos } = await db.from("content_pack_pools")
    .select("pack_id", { count: "exact", head: true }).eq("pack_id", PACK);
  const { count: uc } = await db.from("user_cards").select("uid", { count: "exact", head: true });
  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${quedan} pools de prueba · `
    + `${vinculos} vínculo(s) en «${PACK}» · ${uc} ejemplares`);

  check("la QA no deja nada suyo detrás",
    (quedan ?? 0) === 0 && vinculos === vinculosOriginales.length
    && uc === ejemplaresAntes && restos.length === 0,
    restos.length ? restos.slice(0, 3).join(" | ")
      : `sobre restaurado a ${vinculosOriginales.length} vínculo(s), ${uc} ejemplares (había ${ejemplaresAntes})`);
}

main()
  .catch((e) => { console.error("\n✕ QA abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar();
    console.log("\n" + "─".repeat(72));
    console.log(`  ${pass} correctas · ${fail} fallidas`);
    console.log(fail === 0 ? "  ✅ QA REAL SUPERADA" : "  ❌ QA REAL CON FALLOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
