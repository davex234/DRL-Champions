/**
 * ENSAYO DE LA DEMO — `npm run demo:rehearsal`.
 *
 * Recorre, con un navegador de verdad y **pulsando lo que pulsaría una persona**, el guion
 * exacto de la reunión:
 *
 *   entrar como admin → crear una carta → ver su preview → publicarla → crear un pool →
 *   añadirla → cambiar su peso → publicar el pool → vincularlo a un sobre →
 *   ir a la tienda → abrir un sobre REAL → ver la carta en el revelado →
 *   ir a Colección → verla → ir a Duelos → comprobar que se puede jugar
 *
 * No hay ni una llamada a la API para las partes que un administrador tiene que hacer con el
 * ratón: si un botón no existe, esto falla. Es la diferencia entre «la API lo permite» y «se
 * puede enseñar en una reunión».
 *
 * Deja capturas en `docs/product/qa/demo/` y **lo que crea, lo borra**.
 */
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { launch, type Tab } from "./lib/cdp";

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

const SHOTS = join(ROOT, "docs", "product", "qa", "demo");
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const paso = (n: number, s: string): void => console.log(`\n${n}. ${s}\n${"─".repeat(72)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TTL = 6_000;

const cuentas: string[] = [];
const cartasCreadas: string[] = [];
let poolCreado: string | null = null;
let vinculosOriginales: { pool_id: string; priority: number }[] = [];
let ejemplaresAntes = 0;
const PACK = "estandar";
const VARIANTE_LABEL = "EMEA Winner";
const VARIANTE = "emea-winner";

async function cuenta(tag: string, esAdmin: boolean) {
  const email = `demo-${tag}-${randomUUID()}@nexus.test`;
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

/* ─────────────────────────── Gestos de una persona ─────────────────────────── */

/** Escribe en un campo controlado por React (hay que llamar al setter nativo). */
const escribir = (t: Tab, selector: string, texto: string) => t.js<boolean>(`(() => {
  const i = document.querySelector(${JSON.stringify(selector)});
  if (!i) return false;
  const proto = i.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(i, ${JSON.stringify(texto)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

/** Pulsa el primer botón (o enlace) cuyo texto visible encaje. */
const pulsar = (t: Tab, texto: string) => t.js<boolean>(`(() => {
  const re = new RegExp(${JSON.stringify(texto)}, 'i');
  const b = [...document.querySelectorAll('button, a[href]')]
    .filter(e => e.getBoundingClientRect().width > 0 && !e.disabled)
    .find(e => re.test((e.textContent || '').trim()));
  if (!b) return false; b.click(); return true;
})()`);

/** Pulsa una opción dentro de un `role="listbox"` concreto. */
const elegirEnLista = (t: Tab, listaLabel: string, indice = 0) => t.js<string | null>(`(() => {
  const l = [...document.querySelectorAll('[role="listbox"]')]
    .find(e => (e.getAttribute('aria-label') || '') === ${JSON.stringify(listaLabel)});
  if (!l) return null;
  const opciones = [...l.querySelectorAll('button')].filter(e => !e.disabled);
  const b = opciones[${indice}];
  if (!b) return null;
  const t = (b.textContent || '').trim();
  b.click();
  return t;
})()`);

/** Elige una opción de un `<select>` por su etiqueta accesible. */
const elegirSelect = (t: Tab, label: string, valor: string) => t.js<boolean>(`(() => {
  const s = [...document.querySelectorAll('select')]
    .find(e => (e.getAttribute('aria-label') || '') === ${JSON.stringify(label)});
  if (!s) return false;
  const opt = [...s.options].find(o => o.value === ${JSON.stringify(valor)});
  if (!opt) return false;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')
    .set.call(s, opt.value);
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);

/**
 * Rellena el motivo y confirma DENTRO del diálogo.
 *
 * Se acota a `[role="dialog"]` a propósito: el botón que abrió el diálogo sigue en el DOM
 * detrás, y un `pulsar("Publicar")` global vuelve a pulsar ESE en vez de confirmar. Es un
 * fallo que no da error — el diálogo se queda abierto y la comprobación de después dice que
 * el pool sigue en DRAFT sin explicar por qué.
 */
const confirmarDialogo = (t: Tab, motivo: string, etiqueta: string) => t.js<boolean>(`(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return false;
  const ta = d.querySelector('textarea');
  if (ta) {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      .set.call(ta, ${JSON.stringify(motivo)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const re = new RegExp(${JSON.stringify(etiqueta)}, 'i');
  const b = [...d.querySelectorAll('button')]
    .filter(e => !e.disabled)
    .find(e => re.test((e.textContent || '').trim()));
  if (!b) return false;
  b.click();
  return true;
})()`);

/** ¿Hay un diálogo abierto ahora mismo? */
const hayDialogo = (t: Tab) => t.js<boolean>(`!!document.querySelector('[role="dialog"]')`);

const texto = (t: Tab) => t.js<string>("document.body.innerText");

async function huella(): Promise<string> {
  const h = createHash("sha256");
  for (const [tabla, cols, key] of [
    ["duel_decks", "id, user_id, card_uids", "id"],
    ["market_listings", "id, card_id, price, status", "id"],
    ["content_cards", "card_id, ovr, definition_version, lifecycle", "card_id"],
  ] as const) {
    let q = db.from(tabla).select(cols).order(key);
    for (const c of cartasCreadas) if (tabla !== "duel_decks") q = q.neq("card_id", c);
    const { data } = await q;
    h.update(tabla).update(JSON.stringify(data ?? []));
  }
  return h.digest("hex");
}

/* ─────────────────────────────── El ensayo ─────────────────────────────── */

async function main(): Promise<void> {
  console.log("\n═══ ENSAYO DE LA DEMO — el guion entero, pulsando botones ═══");
  console.log(`  servidor: ${BASE}`);
  const ping = await fetch(`${BASE}/api/game/state`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) { console.error(`\n  ✕ No hay servidor en ${BASE}.\n`); process.exit(1); }

  const admin = await cuenta("admin", true);
  const jugador = await cuenta("jugador", false);
  ejemplaresAntes = (await db.from("user_cards").select("uid", { count: "exact", head: true })).count ?? 0;
  const antesHuella = await huella();
  /*
   * Los vínculos del sobre se apuntan AL EMPEZAR, no cuando se van a cambiar. Si el ensayo se
   * cae por el medio, la limpieza tiene que saber a qué configuración volver — y apuntándolos
   * tarde, un fallo temprano deja el sobre repartiendo lo que no debe.
   */
  const { data: vin0 } = await db.from("content_pack_pools").select("pool_id, priority").eq("pack_id", PACK);
  vinculosOriginales = (vin0 ?? []) as { pool_id: string; priority: number }[];

  // Un jugador del catálogo al que le falte la variante: la carta será nueva de verdad.
  const { data: existentes } = await db.from("content_cards").select("player_id, variant_id");
  const porJugador = new Map<string, Set<string>>();
  for (const r of ((existentes ?? []) as { player_id: string; variant_id: string }[])) {
    const s = porJugador.get(r.player_id) ?? new Set<string>();
    s.add(r.variant_id); porJugador.set(r.player_id, s);
  }
  const { data: nicks } = await db.from("content_players").select("id, nick");
  const nickDe = new Map(((nicks ?? []) as { id: string; nick: string }[]).map((p) => [p.id, p.nick]));
  const elegido = [...porJugador.entries()].find(([id, vs]) => !vs.has(VARIANTE) && nickDe.has(id))?.[0];
  if (!elegido) throw new Error(`no hay ningún jugador sin ${VARIANTE}`);
  const NICK = nickDe.get(elegido)!;

  const { tab, close } = await launch({ width: 1440, height: 900 });
  try {
    // ── 1. Entrar como admin ──
    paso(1, "ENTRAR COMO ADMIN");
    await tab.goto(`${BASE}/`, 1500);
    await tab.setStorage(storageKey(), JSON.stringify(admin.session));
    await tab.goto(`${BASE}/admin/cartas`, 3500);
    const panel = await texto(tab);
    check("el panel de cartas se abre para un administrador",
      !/acceso restringido/i.test(panel) && /cartas/i.test(panel), "sin «Acceso restringido»");
    await tab.shot(join(SHOTS, "01-admin-cartas-1440.png"));

    // ── 2. Crear una carta, desde el formulario ──
    paso(2, "CREAR UNA CARTA — CON EL RATÓN, NO CON CURL");
    await tab.goto(`${BASE}/admin/cartas/nueva`, 3200);
    check("el buscador de jugadores está en pantalla",
      await escribir(tab, 'input[aria-label="Buscar jugador por nick"]', NICK), NICK);
    await sleep(1600);
    const jugadorElegido = await elegirEnLista(tab, "Jugadores", 0);
    check("se elige un jugador de la lista", !!jugadorElegido, (jugadorElegido ?? "").split("\n")[0]);
    await sleep(1200);

    const variante = await tab.js<string | null>(`(() => {
      const l = [...document.querySelectorAll('[role="listbox"]')]
        .find(e => (e.getAttribute('aria-label') || '') === 'Variantes');
      if (!l) return null;
      const b = [...l.querySelectorAll('button')]
        .find(e => /${VARIANTE_LABEL}/i.test(e.textContent || ''));
      if (!b) return null;
      const t = (b.textContent || '').trim(); b.click(); return t;
    })()`);
    check(`se elige la variante «${VARIANTE_LABEL}»`, !!variante, (variante ?? "").split("\n")[0]);
    await sleep(1400);

    // ── 3. La preview ──
    paso(3, "LA PREVIEW: SE VE LA CARTA ANTES DE CREARLA");
    const preview = await tab.js<{ hayCard3D: boolean; ovr: string | null; texto: string }>(`(() => {
      const s = [...document.querySelectorAll('section')]
        .find(e => /previsualiza|preview/i.test(e.textContent || ''));
      const t = document.body.innerText;
      return {
        hayCard3D: !!document.querySelector('[data-card3d], .nx-card3d, [class*="card3d" i]')
          || !!(s && s.querySelector('svg, canvas, img')),
        ovr: (t.match(/OVR\\s*(\\d{2})/i) || [null, null])[1],
        texto: t,
      };
    })()`);
    check("la previsualización enseña la carta antes de guardarla", preview.hayCard3D, "Card3D en pantalla");
    check("y el OVR derivado, que nadie ha tecleado", !!preview.ovr, `OVR ${preview.ovr}`);
    check("los campos derivados NO son editables",
      await tab.js<boolean>(`(() => {
        const editables = [...document.querySelectorAll('input, select, textarea')]
          .filter(e => !e.disabled && e.getBoundingClientRect().width > 0)
          .map(e => (e.getAttribute('aria-label') || e.id || e.placeholder || '').toLowerCase());
        return !editables.some(n => /^(ovr|rareza|rarity|bucket|checksum|source|stats)$/.test(n));
      })()`), "ni OVR, ni rareza, ni source, ni checksum");
    await tab.shot(join(SHOTS, "02-admin-nueva-carta-preview-1440.png"));

    await escribir(tab, 'textarea[placeholder*="Por qué se crea"]', "Demo Day: carta de ejemplo");
    await sleep(400);
    check("se pulsa «Crear»", await pulsar(tab, "^Crear"), "botón real");
    await sleep(3500);

    const CARTA = `${elegido}__${VARIANTE}`;
    const { data: creada } = await db.from("content_cards")
      .select("card_id, lifecycle, definition_version, ovr, rarity_bucket, source")
      .eq("card_id", CARTA).maybeSingle();
    const def = creada as { card_id: string; lifecycle: string; definition_version: number; ovr: number; rarity_bucket: string; source: string } | null;
    check("la carta existe en el catálogo persistido", !!def, CARTA);
    if (!def) throw new Error("la carta no se creó desde la interfaz");
    cartasCreadas.push(CARTA);
    check("nace en DRAFT, versión 1, con rareza y OVR derivados",
      def.lifecycle === "DRAFT" && def.definition_version === 1 && !!def.rarity_bucket,
      `${def.lifecycle} v${def.definition_version} · ${def.rarity_bucket} · OVR ${def.ovr} · source ${def.source}`);

    // ── 4. Publicarla ──
    paso(4, "PUBLICARLA");
    await tab.goto(`${BASE}/admin/cartas/${encodeURIComponent(CARTA)}`, 3500);
    await tab.shot(join(SHOTS, "03-admin-ficha-carta-1440.png"));
    check("se pulsa «Publicar carta»", await pulsar(tab, "Publicar carta"), "botón real");
    await sleep(1400);
    check("se abre el diálogo de confirmación con su motivo", await hayDialogo(tab), "role=dialog");
    check("se confirma en el diálogo", await confirmarDialogo(tab, "Demo Day: publicar", "Publicar"),
      "motivo + confirmar, dentro del diálogo");
    await sleep(3200);

    const { data: pub } = await db.from("content_cards").select("lifecycle").eq("card_id", CARTA).maybeSingle();
    check("la carta queda PUBLICADA", (pub as { lifecycle: string }).lifecycle === "PUBLISHED",
      (pub as { lifecycle: string }).lifecycle);
    const fichaPub = await texto(tab);
    check("y la pantalla lo dice con todas las letras", /publicada|published/i.test(fichaPub), "estado visible");

    // ── 5. Crear el pool ──
    paso(5, "CREAR UN POOL Y AÑADIR LA CARTA");
    await tab.goto(`${BASE}/admin/pools/nueva`, 3200);
    const POOL = `demo-${randomUUID().slice(0, 6)}`;
    await tab.js<boolean>(`(() => {
      const campos = [...document.querySelectorAll('input[type="text"], input:not([type])')]
        .filter(e => e.getBoundingClientRect().width > 0);
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      if (campos[0]) { set.call(campos[0], ${JSON.stringify(POOL)}); campos[0].dispatchEvent(new Event('input', {bubbles:true})); }
      if (campos[1]) { set.call(campos[1], 'Demo Day'); campos[1].dispatchEvent(new Event('input', {bubbles:true})); }
      return true;
    })()`);
    await sleep(500);
    const ta = await tab.js<boolean>(`(() => {
      const t = document.querySelector('textarea');
      if (!t) return false;
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
        .set.call(t, 'Demo Day');
      t.dispatchEvent(new Event('input', { bubbles: true })); return true;
    })()`);
    void ta;
    await sleep(400);
    check("se pulsa «Crear»", await pulsar(tab, "Crear"), POOL);
    await sleep(3200);
    const { data: poolRow } = await db.from("content_pools").select("id, lifecycle").eq("id", POOL).maybeSingle();
    check("el pool existe y nace en DRAFT",
      !!poolRow && (poolRow as { lifecycle: string }).lifecycle === "DRAFT", POOL);
    if (!poolRow) throw new Error("el pool no se creó desde la interfaz");
    poolCreado = POOL;

    // ── 6. Añadir la carta al pool ──
    await tab.goto(`${BASE}/admin/pools/${encodeURIComponent(POOL)}`, 3500);
    // `#buscar-carta` es el buscador del bloque «Añadir una carta». La ficha tiene OTRO campo
    // («Buscar en el pool», `#buscar-entrada`) con un `placeholder` parecido: apuntar por id
    // es la diferencia entre teclear donde hay que teclear y teclear al lado.
    check("el buscador de cartas del pool está en pantalla",
      await escribir(tab, "#buscar-carta", NICK), NICK);
    await sleep(2200);
    const candidata = await tab.js<string | null>(`(() => {
      const l = [...document.querySelectorAll('[role="listbox"]')]
        .find(e => (e.getAttribute('aria-label') || '') === 'Cartas encontradas');
      if (!l) return null;
      const b = [...l.querySelectorAll('button')]
        .find(e => (e.textContent || '').includes(${JSON.stringify(CARTA)}));
      if (!b) return null; const t = (b.textContent||'').trim(); b.click(); return t;
    })()`);
    check("se elige la carta recién creada entre las candidatas", !!candidata,
      (candidata ?? "").split("\n")[0]);
    await sleep(1500);
    await escribir(tab, "#peso-nuevo", "50");
    await escribir(tab, "#motivo-anadir", "Demo Day: al pool");
    await sleep(500);
    check("se pulsa «Añadir»", await pulsar(tab, "Añadir al pool|^Añadir"), "botón real");
    await sleep(3200);

    const { count: entradas } = await db.from("content_pool_entries")
      .select("card_id", { count: "exact", head: true }).eq("pool_id", POOL).eq("card_id", CARTA);
    check("la carta está en el pool", (entradas ?? 0) === 1, "1 entrada");

    // ── 7. Cambiar el peso ──
    paso(7, "CAMBIAR EL PESO Y GUARDAR");
    await tab.goto(`${BASE}/admin/pools/${encodeURIComponent(POOL)}`, 3500);
    const cambiado = await tab.js<boolean>(`(() => {
      const i = [...document.querySelectorAll('input[type="number"]')]
        .find(e => /peso de/i.test(e.getAttribute('aria-label') || ''));
      if (!i) return false;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(i, '50');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    })()`);
    check("se teclea un peso nuevo en la tabla", cambiado, "50");
    await sleep(3000);
    const { data: peso } = await db.from("content_pool_entries")
      .select("weight").eq("pool_id", POOL).eq("card_id", CARTA).maybeSingle();
    check("y se guarda solo, al salir del campo",
      Number((peso as { weight: string } | null)?.weight) === 50,
      `peso ${Number((peso as { weight: string }).weight)}`);
    const hojaPool = await texto(tab);
    check("la ficha enseña el peso, la cuota y la revisión",
      /peso/i.test(hojaPool) && /%/.test(hojaPool) && /r\d+/i.test(hojaPool), "los tres a la vista");
    await tab.shot(join(SHOTS, "04-admin-pool-1440.png"));

    // ── 8. Publicar el pool y vincularlo ──
    paso(8, "PUBLICAR EL POOL Y VINCULARLO AL SOBRE");
    check("se pulsa «Publicar»", await pulsar(tab, "^Publicar$"), "botón real");
    await sleep(1400);
    check("se confirma la activación en el diálogo",
      await confirmarDialogo(tab, "Demo Day: activar", "Publicar|Activar|Confirmar"), "dentro del diálogo");
    await sleep(3200);
    const { data: activo } = await db.from("content_pools").select("lifecycle").eq("id", POOL).maybeSingle();
    check("el pool queda ACTIVO", (activo as { lifecycle: string }).lifecycle === "ACTIVE",
      (activo as { lifecycle: string }).lifecycle);

    // El sobre se deja SOLO con este pool: si no, se uniría al de siempre y la carta se
    // perdería entre 772. En una demo hay que verla salir. (Los vínculos originales ya se
    // apuntaron al empezar.)

    /*
     * PRIMERO se quita el pool que el sobre ya usaba, y se quita DESDE LA PANTALLA.
     *
     * Las dos cosas importan. Que se quite, porque varios pools en un sobre se UNEN: dejando
     * el de siempre, la carta nueva competiría con las 772 de siempre y no saldría. Y que se
     * quite por la interfaz, porque un `delete` directo a la tabla NO sube
     * `content_distribution_version` —eso lo hace `_bump_distribution` dentro de la RPC— y el
     * servidor seguiría repartiendo la configuración anterior sin enterarse. Es exactamente la
     * trampa que 8.4.3 §18 documentó, y la primera versión de este ensayo cayó en ella: el
     * sobre entregaba cinco cartas y ninguna era la nueva.
     */
    for (const v of vinculosOriginales) {
      await tab.goto(`${BASE}/admin/pools/${encodeURIComponent(v.pool_id)}`, 3500);
      check(`se desvincula «${PACK}» del pool que lo usaba (${v.pool_id})`,
        await pulsar(tab, "Desvincular"), "botón real");
      await sleep(3000);
    }
    const { count: sueltos } = await db.from("content_pack_pools")
      .select("pack_id", { count: "exact", head: true }).eq("pack_id", PACK);
    check("el sobre se queda sin pool antes de recibir el nuevo", (sueltos ?? 0) === 0, "0 vínculos");

    await tab.goto(`${BASE}/admin/pools/${encodeURIComponent(POOL)}`, 3500);
    const haySelectSobre = await elegirSelect(tab, "Sobre", PACK);
    check("la ficha ofrece vincular el pool a un sobre", haySelectSobre, `«${PACK}» elegible`);
    await sleep(400);
    check("se pulsa «Vincular»", await pulsar(tab, "^Vincular$"), "botón real");
    await sleep(3000);
    const { count: vinculado } = await db.from("content_pack_pools")
      .select("pack_id", { count: "exact", head: true }).eq("pack_id", PACK).eq("pool_id", POOL);
    check("el sobre usa ahora este pool, y solo este", (vinculado ?? 0) === 1, `${PACK} ← ${POOL}`);
    /*
     * EL POOL SE DEJA CON UNA SOLA CARTA, Y ES UNA DECISIÓN DE DEMO, NO UN ATAJO.
     *
     * El peso compite DENTRO de un bucket; qué bucket toca lo decide el `PackDef`, que vive en
     * código. `estandar` reparte 8 % de `rare`, así que una carta `rare` sale en un hueco el
     * 12,7 % de las veces —renormalizando sobre los buckets con stock— y en un sobre de cinco
     * huecos eso es una moneda al aire: 49 %.
     *
     * Una demo no se juega a cara o cruz. Con la carta sola en el pool, `rollBucket` solo
     * tiene un bucket con stock y el sobre entrega cinco ejemplares suyos, con sus series
     * #1…#5. Se ve la cadena entera y se ve a la primera.
     *
     * Para una demostración más realista basta añadir más cartas al pool desde la misma
     * pantalla — pero entonces hay que estar dispuesto a abrir dos o tres sobres.
     */
    await sleep(TTL);

    // ── 9-11. La tienda y el sobre real ──
    paso(9, "LA ARMERÍA Y UN SOBRE DE VERDAD");
    await tab.goto(`${BASE}/`, 1500);
    await tab.setStorage(storageKey(), JSON.stringify(jugador.session));
    await db.from("profiles").update({ credits: 50_000 }).eq("id", jugador.id);
    await tab.goto(`${BASE}/tienda`, 4000);
    const tienda = await texto(tab);
    check("la tienda se abre y ofrece sobres",
      /sobre/i.test(tienda) && /\d/.test(tienda), tienda.split("\n").slice(0, 2).join(" · ").slice(0, 60));
    await tab.shot(join(SHOTS, "05-tienda-1440.png"));

    await db.from("user_packs").upsert({ user_id: jugador.id, pack_id: PACK, qty: 3 },
      { onConflict: "user_id,pack_id" });
    await tab.goto(`${BASE}/abrir/${PACK}`, 6000);
    /*
     * El sobre NO se abre solo: hay una ceremonia y un botón. Es lo correcto para el producto
     * —abrir un sobre es un gesto, no una carga de página— y significa que el ensayo tiene que
     * pulsarlo igual que lo pulsará quien haga la demo.
     */
    check("la ceremonia del sobre ofrece «Abrir sobre»", await pulsar(tab, "Abrir sobre"), "botón real");
    await sleep(11_000);
    const revelado = await texto(tab);
    const { data: instancias } = await db.from("user_cards")
      .select("uid, serial, minted_version, origin, obtained_at")
      .eq("user_id", jugador.id).eq("card_id", CARTA);
    const inst = (instancias ?? []) as { uid: string; serial: number | null; minted_version: number | null; origin: string; obtained_at: string }[];
    const { count: acunadas } = await db.from("user_cards")
      .select("uid", { count: "exact", head: true }).eq("user_id", jugador.id);
    check("el sobre se abre de verdad y acuña instancias", (acunadas ?? 0) > 0,
      `${acunadas} ejemplares en la cuenta del jugador`);
    check("la carta creada en el panel SALE del sobre", inst.length > 0,
      inst.length ? `${inst.length} ejemplares de ${CARTA}` : `${CARTA} no salió`);
    await tab.shot(join(SHOTS, "06-revelado-1440.png"));

    paso(10, "LA ACUÑACIÓN ES REAL");
    check("cada ejemplar tiene serie, versión, origen y fecha",
      inst.length > 0 && inst.every((i) => i.serial !== null && i.minted_version === 1 && i.origin === "pack" && !!i.obtained_at),
      inst.length ? `#${inst[0].serial} · v${inst[0].minted_version} · ${inst[0].origin}` : "sin ejemplares");
    check("las series no se repiten",
      new Set(inst.map((i) => i.serial)).size === inst.length, `${inst.length} series distintas`);
    check("y el revelado enseña la carta, no un hueco",
      revelado.includes(NICK) || /nueva|carta/i.test(revelado), `«${NICK}» en pantalla`);

    // ── 12-13. Colección ──
    paso(12, "COLECCIÓN");
    await tab.goto(`${BASE}/coleccion`, 5000);
    await sleep(1500);
    const album = await tab.js<{ laNueva: boolean; propias: number; total: number }>(`(() => {
      const et = [...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label') || '');
      const deCarta = et.filter(l => /__/.test(l));
      return {
        laNueva: deCarta.some(l => l.includes(${JSON.stringify(CARTA)})),
        propias: deCarta.filter(l => l.startsWith('Ver ')).length,
        total: deCarta.length,
      };
    })()`);
    check("la carta creada en el panel APARECE en la colección del jugador", album.laNueva,
      album.laNueva ? CARTA : `no aparece · ${album.propias} en posesión de ${album.total} casillas`);
    await tab.shot(join(SHOTS, "07-coleccion-1440.png"));

    // ── 14-15. Duelos ──
    paso(14, "DUELOS: LA CARTA SE PUEDE JUGAR");
    await tab.goto(`${BASE}/duelos/mazos`, 6000);
    await sleep(2000);
    // El constructor vive detrás de «+ Nuevo equipo» (Fase 32; antes «+ Nuevo mazo»): la lista de cartas no está en la pantalla
    // de listado. Leerla sin pulsar mediría una pantalla que no es la que se va a enseñar.
    check("se pulsa «+ Nuevo equipo»", await pulsar(tab, "Nuevo equipo"), "botón real");
    await sleep(3000);
    const mazos = await texto(tab);
    check("el constructor de mazos se abre",
      /mazo|cartas|selecciona/i.test(mazos) && !/no se pudo/i.test(mazos.slice(0, 400)),
      mazos.split("\n").slice(0, 2).join(" · ").slice(0, 60));
    check("y ofrece la carta nueva entre las disponibles",
      mazos.toUpperCase().includes(NICK.toUpperCase()),
      `«${NICK}» en el constructor`);
    await tab.shot(join(SHOTS, "08-duelos-mazos-1440.png"));

    // ── 16. El resto del juego ──
    paso(16, "EL RESTO DEL JUEGO SIGUE EN PIE");
    const RUTAS = ["/", "/inventario", "/colecciones", "/duelos", "/torneos", "/pickems",
      "/entrenador", "/cuenta", "/ranking", "/logros"];
    const rotas: string[] = [];
    for (const r of RUTAS) {
      await tab.goto(`${BASE}${r}`, 2600);
      const t = await texto(tab);
      /*
       * Se busca el OVERLAY DE ERROR, no `<nextjs-portal>`: en desarrollo Next inyecta ese
       * portal siempre —lleva dentro la barra de herramientas— así que buscarlo marcaba las
       * diez rutas como rotas cuando ninguna lo estaba. Un arnés que da diez falsos positivos
       * es peor que no medir.
       */
      const overlay = await tab.js<boolean>(
        `!!document.querySelector('#nextjs__container_errors_label, [data-nextjs-dialog-header]')`);
      if (overlay || t.trim().length < 120) rotas.push(`${r} (${t.trim().length} car.)`);
    }
    check("ninguna ruta principal se queda en blanco ni revienta", rotas.length === 0,
      rotas.length ? rotas.join(", ") : `${RUTAS.length} rutas revisadas`);

    check("nada de lo que existía se ha movido", (await huella()) === antesHuella, "huella idéntica");
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
    for (const r of ((suyas ?? []) as { card_id: string }[])) porCarta.set(r.card_id, (porCarta.get(r.card_id) ?? 0) + 1);
    await db.from("market_listings").delete().eq("seller_id", id);
    await db.from("duel_decks").delete().eq("user_id", id);
    await db.from("user_cards").delete().eq("user_id", id);
    for (const [cardId, n] of porCarta) {
      const { data: m } = await db.from("card_mints").select("minted").eq("card_id", cardId).maybeSingle();
      if (!m) continue;
      const { error } = await db.from("card_mints")
        .update({ minted: Math.max(0, Number((m as { minted: number }).minted) - n) }).eq("card_id", cardId);
      if (error) restos.push(`card_mints ${cardId}: ${error.message}`);
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
  await db.rpc("_bump_distribution", { p_pool_id: null });
  await db.rpc("_bump_catalog");
  for (const id of cuentas) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) restos.push(`cuenta ${id}: ${error.message}`);
  }
  const { count: uc } = await db.from("user_cards").select("uid", { count: "exact", head: true });
  const { count: vin } = await db.from("content_pack_pools")
    .select("pack_id", { count: "exact", head: true }).eq("pack_id", PACK);
  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${uc} ejemplares (había ${ejemplaresAntes}) · `
    + `${vin} vínculo(s) en «${PACK}»`);
  check("el ensayo no deja nada suyo detrás",
    uc === ejemplaresAntes && vin === vinculosOriginales.length && restos.length === 0,
    restos.length ? restos.slice(0, 3).join(" | ") : "sobre restaurado");
}

main()
  .catch((e) => { console.error("\n✕ Ensayo abortado:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar().catch((e) => { console.error("  ✕ limpieza:", e); fail++; });
    console.log("\n" + "─".repeat(72));
    console.log(`  ${pass} correctas · ${fail} fallidas`);
    console.log(fail === 0 ? "  ✅ LA DEMO SE PUEDE HACER DE PRINCIPIO A FIN" : "  ❌ LA DEMO SE ROMPE EN ALGÚN PASO");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
