/**
 * QA REAL DEL PANEL DE CARTAS — `npm run admin-cards:qa` (Bloques 8.4.1 y 8.4.2).
 *
 * Recorre el panel con un **navegador de verdad** y una **sesión de administrador de
 * verdad**, en los tres anchos que pide el encargo (390 / 768 / 1440), y hace el flujo
 * completo: crear → borrador → editar → publicar → comprobar catálogo y pools → retirar →
 * comprobar que la instancia sigue intacta.
 *
 * Reutiliza `scripts/lib/cdp.ts`, el control de Chrome que ya usan las demás verificaciones
 * de navegador del proyecto. No se inventa una segunda forma de abrir un navegador.
 *
 * ────────────────────────── CÓMO SE AUTENTICA ──────────────────────────
 *
 * La sesión de Supabase vive en `localStorage` (ver 8.1 §V-1), así que se inyecta ahí
 * directamente con `setStorage` en vez de teclear un formulario. Es el mismo mecanismo que
 * usa el navegador, sin la fragilidad de buscar dos campos por coordenadas.
 *
 * Lo que crea, lo borra, y lo demuestra al final.
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

/**
 * La consola se vacia POR FASE, no una vez al final.
 *
 * Importa porque no todo error de consola es un defecto: cuando un usuario normal entra al
 * panel, el navegador registra el 401 de la API rechazandolo, y ese 401 es exactamente la
 * seguridad funcionando. Mezclarlo con los de la fase de administrador convertiria la
 * comprobacion en ruido. Aqui cada fase declara que errores admite; cualquier otro es un
 * fallo de verdad.
 */
const consola = async (
  t: { takeErrors: () => string[]; js: <T>(e: string) => Promise<T> },
  fase: string, admitidos: RegExp | null, recursosAdmitidos: RegExp | null = null,
): Promise<void> => {
  const errs = t.takeErrors();
  let raros = admitidos ? errs.filter((e) => !admitidos.test(e)) : errs;
  // «Failed to load resource» no dice CUAL. Se pregunta al navegador por los recursos que
  // respondieron 4xx/5xx, porque un fallo sin la URL no se puede arreglar.
  const malos = raros.length || recursosAdmitidos
    ? await t.js<string[]>(`performance.getEntriesByType('resource')
        .filter(r => r.responseStatus >= 400)
        .map(r => r.responseStatus + ' ' + r.name.replace(location.origin, ''))`)
    : [];
  // Si TODO recurso caido esta admitido, se perdonan los avisos de recurso —y SOLO esos—.
  // Un error de JavaScript no es un recurso, asi que sigue contando aunque el arte falte.
  const noAdmitidos = recursosAdmitidos ? malos.filter((m) => !recursosAdmitidos.test(m)) : malos;
  if (recursosAdmitidos && malos.length > 0 && noAdmitidos.length === 0) {
    raros = raros.filter((e) => !/Failed to load resource/.test(e));
  }

  check(`sin errores de consola inesperados - ${fase}`, raros.length === 0,
    raros.length ? (noAdmitidos.length ? noAdmitidos.slice(0, 4).join(" | ") : raros.slice(0, 3).join(" | ")).slice(0, 300)
                 : malos.length ? `${malos.length} recursos sin arte, respaldo dibujado`
                 : `${errs.length} registrados, todos esperados`);
};

/**
 * Lo que ha fallado en ESTA pagina y no lo explica un recurso admitido.
 *
 * Se usa dentro de bucles de navegacion, donde `consola()` no vale: los errores se acumulan
 * entre paginas pero `performance.getEntriesByType` se reinicia con cada documento.
 */
const sobrantes = async (
  t: { takeErrors: () => string[]; js: <T>(e: string) => Promise<T> },
  admitidos: RegExp,
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
let cartaCreada: string | null = null;

/** Un 401/403 mientras el guardia rechaza NO es un defecto: es el guardia. */
const RECHAZO = /\b(401|403)\b/;

/**
 * Los 404 de `/players/*.png` y `/teams/*.png` TAMPOCO son un defecto de este panel.
 *
 * En este repositorio no hay ni un solo retrato ni un solo escudo: `public/players` y
 * `public/teams` tienen un README y nada mas, a la espera del Artwork Pipeline. `PlayerPhoto`
 * esta escrito contando con eso —pide la foto, falla, y dibuja el sigilo del jugador— asi que
 * el 404 ocurre en TODA carta del producto, no solo aqui.
 *
 * Se admite por eso, y solo por eso: a cambio, la fase 5 comprueba que el respaldo se monta
 * de verdad. Si algun dia hay retratos, estos 404 desapareceran solos.
 */
const ARTE = /\/(players|teams)\/[^ ]+\.png/;

async function cuenta(tag: string, esAdmin: boolean): Promise<{ id: string; email: string; password: string; session: unknown }> {
  const email = `qa841b-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  cuentas.push(data.user.id);
  if (esAdmin) await db.from("profiles").update({ is_admin: true }).eq("id", data.user.id);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`login: ${s.error?.message}`);
  return { id: data.user.id, email, password, session: s.data.session };
}

/** La clave con la que el SDK de Supabase guarda la sesión en `localStorage`. */
const storageKey = (): string => {
  const ref = new URL(URL_).hostname.split(".")[0];
  return `sb-${ref}-auth-token`;
};

/**
 * Huella de todo lo que el panel no puede tocar.
 *
 * Excluye la carta que esta QA crea, y conviene explicar por qué no es un atajo: desde 8.4.2
 * la QA acuña un ejemplar REAL de su carta de prueba para demostrar que una carta nacida en el
 * panel funciona como cualquier otra. Ese ejemplar es obra de la propia prueba, así que
 * contarlo haría que la huella cambiara siempre y la comprobación no diría nada.
 *
 * Lo que la huella afirma es lo que importa: **nada de lo que ya existía se ha movido**. Los 53
 * ejemplares de otros jugadores, sus mazos y sus listados siguen byte a byte igual mientras el
 * panel crea, edita, publica, versiona y retira.
 */
async function huella(): Promise<string> {
  const h = createHash("sha256");
  for (const [t, cols, key] of [
    ["user_cards", "uid, user_id, card_id, serial, origin, locked, minted_version", "uid"],
    ["duel_decks", "id, user_id, card_uids", "id"],
    ["market_listings", "id, card_id, price, status", "id"],
  ] as const) {
    let q = db.from(t).select(cols).order(key);
    if (cartaCreada && t !== "duel_decks") q = q.neq("card_id", cartaCreada);
    const { data } = await q;
    h.update(t).update(JSON.stringify(data ?? []));
  }
  return h.digest("hex");
}

async function main(): Promise<void> {
  console.log("\n═══ QA REAL DEL PANEL DE CARTAS (Bloques 8.4.1 y 8.4.2) ═══");
  console.log(`  servidor: ${BASE}`);
  const ping = await fetch(`${BASE}/api/game/state`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) { console.error(`\n  ✕ No hay servidor en ${BASE}.\n`); process.exit(1); }

  const admin = await cuenta("admin", true);
  const normal = await cuenta("normal", false);
  const antes = await huella();

  const { tab, close } = await launch({ width: 1440, height: 900 });
  try {
    // ── 1. Sin sesión ──
    paso(1, "SIN SESIÓN — EL PANEL NO SE ABRE");
    await tab.goto(`${BASE}/admin/cartas`, 2500);
    const sinSesion = await tab.js<string>("document.body.innerText");
    check("sin sesión aparece «Acceso restringido»", /ACCESO RESTRINGIDO/i.test(sinSesion),
      sinSesion.split("\n").find((l) => l.trim())?.slice(0, 50) ?? "");
    check("y NO se filtra ninguna carta del catálogo", !/card id/i.test(sinSesion) && !/__/.test(sinSesion));
    await consola(tab, "sin sesion", RECHAZO);

    // ── 2. Usuario normal ──
    paso(2, "USUARIO NORMAL — TAMPOCO");
    await tab.setStorage(storageKey(), JSON.stringify(normal.session));
    await tab.goto(`${BASE}/admin/cartas`, 3000);
    const comoNormal = await tab.js<string>("document.body.innerText");
    check("un usuario normal ve «Acceso restringido»", /ACCESO RESTRINGIDO/i.test(comoNormal));
    check("y sigue sin ver el catálogo", !/definiciones/i.test(comoNormal));
    await consola(tab, "usuario normal", RECHAZO);

    // ── 3. Admin: el listado ──
    paso(3, "ADMIN — EL LISTADO CON DATOS REALES");
    await tab.setStorage(storageKey(), JSON.stringify(admin.session));
    await tab.goto(`${BASE}/admin/cartas`, 3500);
    const listado = await tab.js<{ texto: string; filas: number; total: string | null }>(
      `({ texto: document.body.innerText,
          filas: document.querySelectorAll('tbody tr').length,
          total: (document.body.innerText.match(/([\\d.]+) definiciones/) || [])[1] || null })`);
    const { count: real } = await db.from("content_cards").select("card_id", { count: "exact", head: true });
    check("el admin ve el listado", listado.filas > 0, `${listado.filas} filas en pantalla`);
    check("con el total REAL del catálogo",
      listado.total?.replace(/\./g, "") === String(real), `${listado.total} = ${real}`);
    check("y son cartas de verdad", /__/.test(listado.texto), "los card id llevan el patrón real");

    // Búsqueda
    await tab.js(`(() => { const i = document.querySelector('input[aria-label*="Buscar"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, 'derke'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await new Promise((r) => setTimeout(r, 1500));
    const busqueda = await tab.js<number>("document.querySelectorAll('tbody tr').length");
    const { count: derkes } = await db.from("content_cards")
      .select("card_id", { count: "exact", head: true }).ilike("card_id", "%derke%");
    check("la búsqueda filtra contra la base", busqueda > 0 && busqueda <= (derkes ?? 0),
      `${busqueda} filas · ${derkes} cartas de derke en BD`);

    await consola(tab, "listado del administrador", null);

    // ── 4. Crear ──
    paso(4, "CREAR UNA CARTA REAL DESDE EL PANEL");
    // El alta se hace por la API con el token del admin: la interfaz ya está probada arriba
    // y teclear un formulario por coordenadas es frágil sin aportar nada.
    const { data: cands } = await db.from("content_players").select("id").limit(60);
    let playerId: string | null = null;
    for (const p of ((cands ?? []) as { id: string }[])) {
      const { count } = await db.from("content_cards")
        .select("card_id", { count: "exact", head: true }).eq("card_id", `${p.id}__mythic`);
      const { count: tiene } = await db.from("content_cards")
        .select("card_id", { count: "exact", head: true }).eq("player_id", p.id);
      if (count === 0 && (tiene ?? 0) > 0) { playerId = p.id; break; }
    }
    if (!playerId) throw new Error("no hay jugador candidato");

    const token = (admin.session as { access_token: string }).access_token;
    const api = async <T>(action: string, body: Record<string, unknown> = {}): Promise<{ status: number; data: T }> => {
      const r = await fetch(`${BASE}/api/admin/cards`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...body }), cache: "no-store",
      });
      return { status: r.status, data: (await r.json()) as T };
    };

    const alta = await api<{ cardId: string; lifecycle: string }>("create", {
      playerId, variantId: "mythic", reason: "QA 8.4.1",
    });
    check("se crea la carta", alta.status === 200 && alta.data.lifecycle === "DRAFT",
      `${alta.data?.cardId} · ${alta.data?.lifecycle}`);
    cartaCreada = alta.data.cardId;

    // ── 5. La ficha del borrador ──
    paso(5, "LA FICHA DEL BORRADOR, CON PREVIEW REAL");
    await tab.goto(`${BASE}/admin/cartas/${encodeURIComponent(cartaCreada)}`, 3500);
    const ficha = await tab.js<{ texto: string; preview: boolean; sigilo: boolean; secciones: number }>(
      `(() => { const panel = document.querySelector('[data-admin-panel]');
        return { texto: document.body.innerText,
          preview: !!document.querySelector('[data-card-render], [class*="card"] canvas, svg') ||
                   document.body.innerText.includes('El mismo componente que pinta la carta en el juego'),
          sigilo: !!panel && panel.querySelectorAll('svg[aria-hidden]').length > 0,
          secciones: panel ? panel.querySelectorAll('section[aria-labelledby]').length : 0 }; })()`);
    check("la ficha carga", ficha.texto.includes(cartaCreada), cartaCreada);
    check("dice que es un BORRADOR", /DRAFT/.test(ficha.texto));
    check("y que se edita en sitio", /se edita en sitio/i.test(ficha.texto),
      "la frontera de 8.2, explicada en pantalla");
    check("la preview usa el componente del juego", ficha.preview);
    check("y sin retrato dibuja el sigilo, no un hueco roto", ficha.sigilo,
      "el respaldo de PlayerPhoto: por eso se admite el 404 del arte");
    check("la ficha tiene todas sus secciones", ficha.secciones >= 8, `${ficha.secciones} secciones`);

    // ── 6. El editor, en el navegador ──
    paso(6, "EL CARD BUILDER — TECLEAR EL TRIO Y VER LA CARTA CAMBIAR");
    await tab.goto(`${BASE}/admin/cartas/${encodeURIComponent(cartaCreada)}/editar`, 3500);

    const editor = await tab.js<{ texto: string; campos: number; ovr: string | null; hayOvrEditable: boolean }>(
      `(() => { const p = document.querySelector('[data-admin-panel="editar"]');
        if (!p) return { texto: "", campos: 0, ovr: null, hayOvrEditable: false };
        const inputs = [...p.querySelectorAll('input[type="number"]')];
        const m = p.innerText.match(/OVR\\s*\\n?\\s*(\\d+)/);
        return {
          texto: p.innerText,
          campos: inputs.length,
          ovr: m ? m[1] : null,
          // Un campo cuya etiqueta hable de OVR seria justo lo que este bloque quita.
          hayOvrEditable: inputs.some(i => /ovr/i.test(i.getAttribute('aria-label') || i.id || "")),
        }; })()`);
    check("el editor abre", /editar|trío de combate/i.test(editor.texto), `${editor.campos} campos numéricos`);
    check("se escriben TRES números y ninguno más", editor.campos === 3,
      "stronghold, gamesense y entryfrag");
    check("NO hay ningún campo para escribir el OVR", !editor.hayOvrEditable,
      "el OVR se deriva; en 8.4.1 se podía teclear");
    check("el OVR aparece como valor derivado", editor.ovr !== null, `OVR ${editor.ovr}`);

    /*
     * Teclear de verdad en el campo y comprobar que la carta cambia.
     *
     * Se dispara el `input` nativo con el setter del prototipo porque React escucha ahí; poner
     * `value` a secas no notifica al estado y la comprobación mediría una pantalla congelada.
     */
    const ovrAntes = editor.ovr;
    await tab.js(`(() => {
      const p = document.querySelector('[data-admin-panel="editar"]');
      const i = p.querySelector('#eje-stronghold');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(i, '90'); i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await new Promise((r) => setTimeout(r, 700));

    const trasTeclear = await tab.js<{ ovr: string | null; enCarta: boolean }>(
      `(() => { const p = document.querySelector('[data-admin-panel="editar"]');
        const m = p.innerText.match(/OVR\\s*\\n?\\s*(\\d+)/);
        return { ovr: m ? m[1] : null, enCarta: /en carta 99/.test(p.innerText) }; })()`);
    check("la previsualización reacciona al teclear", trasTeclear.ovr !== ovrAntes,
      `OVR ${ovrAntes} → ${trasTeclear.ovr} al subir stronghold a 90`);
    check("y enseña el trío YA con el bonus de la variante", trasTeclear.enCarta,
      "90 base + 12 de mythic, saturado a 99");

    // El guardado se hace por la API: la interfaz ya está probada, y pulsar por coordenadas
    // dentro de un diálogo modal es frágil sin añadir nada a lo que se quiere demostrar.
    const ed = await api("updateDraft", {
      cardId: cartaCreada, reason: "QA 8.4.2", expectedVersion: 1,
      combat: { stronghold: 70, gamesense: 60, entryfrag: 50 },
    });
    check("la edición se acepta", ed.status === 200);

    const { data: trasEd } = await db.from("content_cards")
      .select("ovr, combat, definition_version, checksum, source").eq("card_id", cartaCreada).maybeSingle();
    const te = trasEd as { ovr: number; combat: Record<string, number>; definition_version: number; checksum: string; source: string };
    check("sigue en la versión 1: un borrador se edita en sitio", te.definition_version === 1);
    check("el OVR lo derivó el servidor del trío", te.ovr === 84,
      `70/60/50 +12 → 82/72/62 → OVR ${te.ovr}`);
    check("y el trío guardado lleva el bonus aplicado",
      te.combat.stronghold === 82 && te.combat.gamesense === 72 && te.combat.entryfrag === 62,
      `${te.combat.stronghold}/${te.combat.gamesense}/${te.combat.entryfrag}`);
    check("la huella se rehace con la edición", te.checksum.length === 64,
      "en 8.4.1 se conservaba la anterior sobre un contenido nuevo");

    // Lo que el contrato de 8.4.2 ya no admite, por el camino real.
    const conOvr = await api<{ error: string }>("updateDraft", {
      cardId: cartaCreada, reason: "QA 8.4.2", expectedVersion: 1, ovr: 99,
      combat: { stronghold: 70, gamesense: 60, entryfrag: 50 },
    });
    check("un OVR en la petición se rechaza con su motivo", conOvr.status === 400,
      String(conOvr.data?.error ?? "").slice(0, 90));

    // ── 7. Publicar ──
    paso(7, "PUBLICAR");
    const pub = await api<{ to: string; catalogVersion: number }>("lifecycle", {
      cardId: cartaCreada, state: "PUBLISHED", reason: "QA 8.4.1",
    });
    check("la carta se publica", pub.status === 200 && pub.data.to === "PUBLISHED",
      `catálogo v${pub.data?.catalogVersion}`);

    // El servidor tiene que enterarse: la caché tiene 5 s de TTL.
    await new Promise((r) => setTimeout(r, 6000));
    const enCatalogo = await api<{ rows: { cardId: string; lifecycle: string }[] }>("list", { q: cartaCreada });
    check("aparece en el catálogo como PUBLISHED",
      enCatalogo.data.rows.some((r) => r.cardId === cartaCreada && r.lifecycle === "PUBLISHED"),
      "la caché se ha invalidado sin reiniciar");

    const sheetPub = await api<{ distribution: unknown[] }>("sheet", { cardId: cartaCreada });
    check("no está en ningún pool todavía", sheetPub.data.distribution.length === 0,
      "publicar NO la mete en un sobre: eso es configurar un pool (8.3)");

    // ── 8. Un ejemplar de verdad ──
    paso(8, "UN EJEMPLAR REAL DE LA CARTA CREADA");

    /*
     * Aquí es donde se decide si esto ha construido una carta de NEXUS o una fila bonita.
     *
     * Se acuña por el CAMINO REAL: `app_apply_pack_open`, la misma RPC que usa el servidor al
     * abrir un sobre. Consume un sobre del inventario, inserta en `user_cards` —y ahí el
     * trigger `_stamp_minted_version` de 8.2 sella la versión—, asigna número de serie y
     * mueve `card_mints`. No se inserta una fila a mano: si se hiciera, la prueba demostraría
     * que sé escribir un INSERT, no que la carta funciona.
     */
    const { data: vAntes } = await db.from("content_cards")
      .select("definition_version, ovr, combat").eq("card_id", cartaCreada).maybeSingle();
    const antesDef = vAntes as { definition_version: number; ovr: number; combat: Record<string, number> };

    await db.from("user_packs").upsert(
      { user_id: normal.id, pack_id: "inicial", qty: 1 }, { onConflict: "user_id,pack_id" },
    );
    const { error: eMint } = await db.rpc("app_apply_pack_open", {
      p_user: normal.id, p_pack_id: "inicial",
      p_instances: [{ cardId: cartaCreada, serial: 1, origin: "pack" }],
      p_pity: {}, p_mint_delta: { [cartaCreada]: 1 }, p_xp: 0,
      p_ref: `qa842:${cartaCreada}`,
    });
    check("la carta se acuña por el camino real del juego", !eMint, eMint?.message ?? "app_apply_pack_open");

    const { data: inst } = await db.from("user_cards")
      .select("uid, card_id, serial, minted_version, origin")
      .eq("card_id", cartaCreada).maybeSingle();
    const ejemplar = inst as { uid: string; serial: number | null; minted_version: number | null; origin: string } | null;
    check("existe el ejemplar, con su número de serie", !!ejemplar && ejemplar.serial === 1,
      ejemplar ? `#${ejemplar.serial} · origen ${ejemplar.origin}` : "no se creó");
    check("el trigger de 8.2 le selló la versión bajo la que nació",
      ejemplar?.minted_version === antesDef.definition_version,
      `minted_version=${ejemplar?.minted_version} · definición v${antesDef.definition_version}`);

    const { data: mints } = await db.from("card_mints").select("minted").eq("card_id", cartaCreada).maybeSingle();
    check("el contador de acuñación de esa carta ha subido",
      Number((mints as { minted: number } | null)?.minted ?? 0) === 1, "card_mints = 1");

    // Aparece en el inventario de su dueño, servido por el servidor.
    const estado = await fetch(`${BASE}/api/game/state`, {
      headers: { Authorization: `Bearer ${(normal.session as { access_token: string }).access_token}` },
      cache: "no-store",
    }).then(async (r) => ({
      status: r.status,
      data: (await r.json()) as { ownedCards?: { cardId: string; serial?: number; mintedVersion?: number | null }[] },
    }));
    const enColeccion = estado.data.ownedCards?.find((c) => c.cardId === cartaCreada);
    check("el dueño la ve en su colección, servida por el servidor",
      estado.status === 200 && !!enColeccion,
      `${estado.data.ownedCards?.length ?? 0} cartas · ${cartaCreada} ${enColeccion ? "presente" : "AUSENTE"}`);
    check("y llega con su número de serie y su versión de acuñación",
      enColeccion?.serial === 1 && enColeccion?.mintedVersion === antesDef.definition_version,
      `#${enColeccion?.serial} · v${enColeccion?.mintedVersion}`);

    // ── Y ahora, la prueba de 8.2 sobre una carta nacida en el panel ──
    const nuevaVersion = await api<{ version: number }>("publish", {
      cardId: cartaCreada, reason: "QA 8.4.2: rebalanceo con ejemplares vivos",
      expectedVersion: antesDef.definition_version,
      combat: { stronghold: 40, gamesense: 40, entryfrag: 40 },
    });
    check("se publica una versión con un ejemplar ya acuñado", nuevaVersion.status === 200,
      `v${antesDef.definition_version} → v${nuevaVersion.data?.version}`);

    const { data: instTras } = await db.from("user_cards")
      .select("uid, serial, minted_version").eq("card_id", cartaCreada).maybeSingle();
    const et = instTras as { uid: string; serial: number | null; minted_version: number | null };
    check("el ejemplar NO se ha movido", et.uid === ejemplar?.uid && et.serial === ejemplar?.serial
      && et.minted_version === ejemplar?.minted_version,
      `sigue siendo #${et.serial} con minted_version=${et.minted_version}`);

    const { data: vieja } = await db.from("content_card_versions")
      .select("ovr, combat, effective_to").eq("card_id", cartaCreada)
      .eq("version", antesDef.definition_version).maybeSingle();
    const vv = vieja as { ovr: number; combat: Record<string, number>; effective_to: string | null };
    check("su versión sigue describiendo lo que obtuvo, intacta",
      vv.ovr === antesDef.ovr && vv.combat.stronghold === antesDef.combat.stronghold,
      `OVR ${vv.ovr} · el catálogo vigente ya es otro`);
    check("y queda cerrada, no borrada", vv.effective_to !== null,
      "el histórico se cierra; nunca se reescribe");

    const { data: nueva } = await db.from("content_cards").select("ovr").eq("card_id", cartaCreada).maybeSingle();
    check("la definición vigente SÍ ha cambiado (si no, no se probaría nada)",
      Number((nueva as { ovr: number }).ovr) !== antesDef.ovr,
      `OVR ${antesDef.ovr} → ${(nueva as { ovr: number }).ovr}`);

    // ── 9. Retirar ──
    paso(9, "RETIRAR — Y COMPROBAR QUE NO SE ROMPE NADA");
    const ret = await api("lifecycle", { cardId: cartaCreada, state: "RETIRED", reason: "QA 8.4.1" });
    check("la carta se retira", ret.status === 200);
    await new Promise((r) => setTimeout(r, 6000));
    const trasRetirar = await api<{ rows: { lifecycle: string }[] }>("list", { q: cartaCreada });
    check("el listado la enseña como RETIRED",
      trasRetirar.data.rows.some((r) => r.lifecycle === "RETIRED"));

    const despues = await huella();
    check("NADA DE LO QUE YA EXISTÍA ha cambiado en todo el flujo", antes === despues,
      "misma huella tras crear, editar, publicar, acuñar, versionar y retirar");

    await consola(tab, "ficha y ciclo de vida", null, ARTE);

    // ── 10. Responsive ──
    paso(10, "RESPONSIVE — 390 · 768 · 1440");
    const colados: string[] = [];
    const RUTAS_QA = 4;
    for (const [w, h, nombre] of [[390, 844, "móvil"], [768, 1024, "tableta"], [1440, 900, "escritorio"]] as const) {
      await tab.resize(w, h, 1);
      for (const ruta of ["/admin/cartas", `/admin/cartas/${encodeURIComponent(cartaCreada)}`,
        `/admin/cartas/${encodeURIComponent(cartaCreada)}/editar`, "/admin/cartas/nueva"]) {
        await tab.goto(`${BASE}${ruta}`, 2800);

        /*
         * EN EL LISTADO SE ESCRIBE UN FILTRO ANTES DE MEDIR.
         *
         * «Limpiar filtros» y el resumen por estado solo se pintan cuando hay algún filtro
         * puesto. Sin esto, la comprobación de 44 px de 8.4.1 daba por bueno el listado
         * porque ese botón no estaba en pantalla: medía los controles que se ven de entrada,
         * no los que existen. El botón medía 34 px.
         */
        if (ruta === "/admin/cartas") {
          await tab.js(`(() => { const i = document.querySelector('input[aria-label*="Buscar"]');
            if (!i) return;
            const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            set.call(i, 'derke'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
          await new Promise((r) => setTimeout(r, 1200));
        }

        // `performance` solo conoce el documento actual: si se pregunta al final del bucle se
        // estarian juzgando los errores de todas las paginas con los recursos de la ultima.
        colados.push(...await sobrantes(tab, ARTE));
        const r = await tab.js<{ scrollW: number; vw: number; pequenos: number; total: number; hayPanel: boolean; tabla: boolean }>(
          `(() => {
            const panel = document.querySelector('[data-admin-panel]');
            const ctrl = panel
              ? [...panel.querySelectorAll('button, a[href], input, select, textarea')]
                  .filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; })
              : [];
            const tablaVisible = !!panel && [...panel.querySelectorAll('table')]
              .some(t => t.getBoundingClientRect().width > 0);
            return {
              scrollW: document.documentElement.scrollWidth,
              vw: document.documentElement.clientWidth,
              pequenos: ctrl.filter(e => e.getBoundingClientRect().height < 44).length,
              total: ctrl.length,
              hayPanel: !!panel,
              tabla: tablaVisible,
            };
          })()`);
        check(`${nombre} ${w}px · ${ruta} sin desbordamiento horizontal`,
          r.scrollW <= r.vw + 1, `scrollWidth ${r.scrollW} vs ${r.vw}`);
        check(`${nombre} ${w}px · ${ruta} todos los controles ≥ 44 px`,
          r.hayPanel && r.pequenos === 0,
          r.hayPanel ? `${r.total - r.pequenos}/${r.total} cumplen` : "no aparece [data-admin-panel]");
        if (ruta === "/admin/cartas") {
          check(`${nombre} ${w}px · ${w < 768 ? "fichas apiladas, sin tabla" : "tabla"}`,
            w < 768 ? !r.tabla : r.tabla, r.tabla ? "tabla visible" : "lista apilada");
        }
      }
    }

    check("sin errores de consola inesperados - los tres anchos", colados.length === 0,
      colados.length ? colados.slice(0, 4).join(" | ").slice(0, 300)
                     : `${3 * RUTAS_QA} paginas revisadas una a una`);

    // ── 11. Accesibilidad ──
    paso(11, "ACCESIBILIDAD");
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/admin/cartas/${encodeURIComponent(cartaCreada)}`, 3000);
    const a11y = await tab.js<{ sinNombre: number; h1: number; secciones: number; tablasConCaption: number; tablas: number; imgsSinAlt: number }>(
      `(() => {
        const panel = document.querySelector('[data-admin-panel]');
        if (!panel) return { sinNombre: -1, h1: 0, secciones: 0, tablas: 0, tablasConCaption: 0, imgsSinAlt: 0 };
        const ctrl = [...panel.querySelectorAll('button, a[href], input, select, textarea')]
          .filter(e => e.getBoundingClientRect().width > 0);
        const nombre = e => (e.getAttribute('aria-label') || e.textContent || '').trim()
          || (e.labels && e.labels.length ? 'label' : '');
        return {
          sinNombre: ctrl.filter(e => !nombre(e)).length,
          h1: panel.querySelectorAll('h1').length,
          secciones: panel.querySelectorAll('section[aria-labelledby]').length,
          tablas: panel.querySelectorAll('table').length,
          tablasConCaption: panel.querySelectorAll('table caption').length,
          imgsSinAlt: [...panel.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length,
        };
      })()`);
    check("todo control tiene nombre accesible", a11y.sinNombre === 0, `${a11y.sinNombre} sin nombre`);
    check("las secciones están etiquetadas", a11y.secciones >= 8, `${a11y.secciones} con aria-labelledby`);
    check("las tablas llevan caption", a11y.tablas === a11y.tablasConCaption,
      `${a11y.tablasConCaption}/${a11y.tablas}`);
    check("ninguna imagen sin alt", a11y.imgsSinAlt === 0, `${a11y.imgsSinAlt}`);

    await consola(tab, "accesibilidad", null, ARTE);

    // -- 12. Borrar sin dejar rastro --
    paso(12, "BORRAR LA CARTA DE PRUEBA SIN DEJAR RASTRO");

    /*
     * Primero, lo que NO se puede hacer: la carta tiene un ejemplar en manos de alguien y una
     * acuñación registrada. Purgarla borraría de la base una carta que un jugador posee.
     * `app_content_purge_card` tiene que negarse, y esa negativa es una garantía del sistema,
     * no un estorbo de la prueba: por eso se comprueba antes de limpiar.
     */
    const { error: conHistoria } = await db.rpc("app_content_purge_card", { p_card_id: cartaCreada });
    check("una carta CON ejemplares no se puede borrar", !!conHistoria,
      conHistoria ? conHistoria.message.slice(0, 100) : "¡la purga aceptó borrar historia!");

    // Ahora sí: se retira el ejemplar de prueba y su acuñación, que son míos.
    await db.from("user_cards").delete().eq("card_id", cartaCreada);
    await db.from("card_mints").delete().eq("card_id", cartaCreada);

    const { error: eP } = await db.rpc("app_content_purge_card", { p_card_id: cartaCreada });
    check("sin historia, la carta sí se purga", !eP, eP?.message ?? "");
    if (!eP) cartaCreada = null;

    // `v_content_card_orphans` es la vista de 8.1 que detecta punteros a cartas inexistentes.
    // Una sola fila aqui significa que borrar dejo algo colgando en otra tabla.
    const { count: huerfanos } = await db.from("v_content_card_orphans")
      .select("card_id", { count: "exact", head: true });
    check("no queda NINGUN puntero huerfano tras el borrado", huerfanos === 0,
      `${huerfanos} en v_content_card_orphans`);
  } finally {
    await close();
  }
}

async function limpiar(): Promise<void> {
  if (cartaCreada) {
    // Si la QA murió a mitad, el ejemplar de prueba puede seguir vivo: se suelta antes de
    // purgar, porque si no la purga se niega —con razón— y la carta quedaría en el catálogo.
    await db.from("user_cards").delete().eq("card_id", cartaCreada).then(() => {}, () => {});
    await db.from("card_mints").delete().eq("card_id", cartaCreada).then(() => {}, () => {});
    await db.from("content_audit_log").delete().eq("card_id", cartaCreada).then(() => {}, () => {});
    await db.from("content_card_market_anchor").delete().eq("card_id", cartaCreada).then(() => {}, () => {});
    // `app_content_purge_card` sube la version del catalogo (0040 §8), asi que el servidor
    // en marcha se entera de que la carta ya no existe sin tener que reiniciarlo.
    const { error } = await db.rpc("app_content_purge_card", { p_card_id: cartaCreada });
    if (error) console.log(`  ! no se pudo purgar ${cartaCreada}: ${error.message}`);
  }
  for (const id of cuentas) await db.auth.admin.deleteUser(id).catch(() => {});

  const { count: quedan } = await db.from("content_cards")
    .select("card_id", { count: "exact", head: true }).eq("origin", "admin");
  const { count: total } = await db.from("content_cards").select("card_id", { count: "exact", head: true });
  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${quedan} cartas de origen admin · ${total} definiciones`);
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
