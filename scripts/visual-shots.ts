/**
 * CAPTURAS VISUALES — juegos ANTES / DESPUÉS.
 *
 *   npm run dev                     (en otra terminal)
 *   npm run visual:shots -- before
 *   npm run visual:shots -- after
 *
 * Existe aparte de `ux:verify --shots` porque su propósito es distinto: aquel VERIFICA
 * (desbordamientos, zonas táctiles, nodos) y solo fotografía de paso. Esto COMPARA: guarda
 * dos juegos etiquetados de las mismas pantallas y en los mismos estados para poder poner
 * el antes y el después uno al lado del otro.
 *
 * Y captura estados que un recorrido de rutas no alcanza nunca: el modal de una carta
 * abierto, el sobre sellado, la revelación, la arena con una partida en curso y el
 * resultado. Son justo las pantallas donde se decide si esto parece un videojuego.
 *
 * La cuenta se siembra con cartas, sobres, créditos, puntos y un mazo, porque una pantalla
 * vacía no dice nada sobre el diseño.
 *
 * ─────────────────────────── DOS ARREGLOS DE LA FASE 9.6 ───────────────────────────
 *
 * **1. La partida no se jugaba.** El recorrido de la arena buscaba un botón «Confirmar» y
 * unos botones «Stronghold / Gamesense / Entryfrag». Ninguno de los dos existe: el botón de
 * confirmar cambia de texto según el paso («Elige una carta» → «Declarar y atacar» →
 * «Responder») y las estadísticas se rotulan con su abreviatura (SH / GS / EF). Los bucles
 * salían en la primera vuelta, así que `07-arena-reveal`, `32-resultado` y `33-replay`
 * guardaban **la misma imagen** que `06-arena-turno1` —se ve en el juego de la Fase 9.5:
 * los tres ficheros pesan exactamente lo mismo—. Ahora se usan los mismos selectores que
 * `duel:e2e`, que sí juega la partida entera.
 *
 * **2. Las ceremonias salían quietas.** Chrome sin cabeza declara
 * `prefers-reduced-motion: reduce`, así que cualquier captura de una animación era una foto
 * de su estado en reposo. El juego comparable se sigue tomando así —es estable y es lo que
 * permite poner el antes y el después uno al lado del otro—, pero las capturas de la
 * ceremonia de apertura se toman aparte con el movimiento ACTIVADO y con su propio nombre
 * (`…-ceremonia`), porque de una ceremonia no se puede juzgar el reposo.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CardRegistry } from "@/collection/registry";
import { DUEL_ROLES } from "@/domain/cardgame";
import { launch, sleep, type Browser } from "./lib/cdp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const LABEL = (process.argv[2] ?? "before").replace(/[^a-z0-9-]/gi, "") || "before";
const OUT = join(ROOT, "docs", "product", "visual", LABEL);

/** Anchos. El grueso a 1440; el móvil solo en las pantallas donde más se juega. */
const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** Pantallas simples: navegar y disparar. */
const SCREENS: { path: string; name: string; phone?: boolean; settle?: number }[] = [
  { path: "/", name: "01-inicio", phone: true },
  { path: "/duelos", name: "02-duelos", phone: true },
  { path: "/duelos/mazos", name: "03-mazos" },
  { path: "/duelos/jugar", name: "05-duelo-lobby", phone: true },
  { path: "/coleccion", name: "08-coleccion", phone: true, settle: 3200 },
  { path: "/inventario", name: "10-inventario" },
  { path: "/colecciones", name: "11-colecciones" },
  { path: "/mercado", name: "12-mercado", settle: 3200 },
  { path: "/tienda", name: "13-tienda", phone: true },
  { path: "/logros", name: "16-progreso-pase", phone: true, settle: 3200 },
  { path: "/ranking", name: "17-ranking" },
  { path: "/cuenta", name: "18-perfil" },
  { path: "/recompensas", name: "19-recompensas" },
  { path: "/torneos", name: "20-torneos" },
  { path: "/pickems", name: "21-pickems" },
  { path: "/eventos", name: "22-eventos" },
  { path: "/entrenador", name: "23-entrenador", phone: true },
  { path: "/entrenador/equipos", name: "24-equipos" },
  { path: "/entrenador/mapas", name: "25-mapas" },
  { path: "/entrenador/strats", name: "26-strats", settle: 3200 },
  { path: "/entrenador/partido", name: "27-partido" },
  { path: "/carrera", name: "28-carrera" },
  { path: "/manager", name: "29-manager" },
  { path: "/mundo", name: "30-mundo" },
  { path: "/noticias", name: "31-noticias" },
];

function duelReadyCardIds(): string[] {
  const registry = new CardRegistry();
  const ids: string[] = [];
  for (const role of DUEL_ROLES) {
    const best = new Map<string, { id: string; ovr: number }>();
    for (const c of registry.forRole(role)) {
      if (!c.combat) continue;
      const prev = best.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) best.set(c.playerId, { id: c.id, ovr: c.ovr });
    }
    const arr = [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
    if (arr[0]) ids.push(arr[0].id);
    if (arr[1]) ids.push(arr[1].id);
  }
  return ids;
}

/** Cartas variadas para que la colección no se vea toda del mismo color. */
function assortedCardIds(limit: number): string[] {
  const registry = new CardRegistry();
  const all = registry.cards.filter((c) => c.combat);
  const seen = new Set<string>();
  const out: string[] = [];
  // Se recorre alternando por rareza para que salgan variantes distintas.
  for (const c of [...all].sort((a, b) => b.ovr - a.ovr)) {
    if (seen.has(c.playerId)) continue;
    seen.add(c.playerId);
    out.push(c.id);
    if (out.length >= limit) break;
  }
  return out;
}

async function seed(admin: SupabaseClient, userId: string) {
  /*
   * La cuenta se siembra con cartas DISTINTAS y, desde la Fase 11, con unas cuantas
   * REPETIDAS. Sin duplicados, el inventario no tiene nada que desguazar y la pantalla
   * que la Fase 11 añadió no aparece en ninguna captura: se estaría fotografiando un
   * estado que ningún jugador con horas de juego tiene.
   */
  const distinct = [...new Set([...duelReadyCardIds(), ...assortedCardIds(70)])];
  const dupes = distinct.slice(0, 8).flatMap((id) => [id, id]);
  const ids = [...distinct, ...dupes];
  await admin.rpc("app_grant_cards", {
    p_user: userId,
    p_instances: ids.map((cardId) => ({ cardId, serial: null })),
    p_mint_delta: {},
    p_origin: "admin",
  });
  await admin.rpc("app_grant_reward", {
    p_user: userId,
    p_ref: `visual-seed:${userId}`,
    p_reason: "admin",
    p_credits: 80_000,
    p_xp: 9000,
    p_tokens: 2500,
    p_pack_id: "premium",
    p_pack_count: 5,
  });
    /*
   * COSMETICOS (Fase 12). Se conceden por la RPC de recompensa REAL y se equipan por
   * `app_equip_cosmetic`, que comprueba la propiedad: no se escribe `profiles.equipped` a
   * mano. La captura del perfil tiene que ensenar el mismo camino que recorre un jugador
   * -desbloquear, equipar, ver-, no un estado colocado a dedo para la foto.
   */
  await admin.rpc("app_grant_reward", {
    p_user: userId,
    p_ref: `visual-seed-cosmetics:${userId}`,
    p_reason: "admin",
    p_credits: 0, p_xp: 0, p_tokens: 0, p_pack_id: null, p_pack_count: 0,
    p_points: 0, p_card_ids: null,
    p_cosmetics: ["titulo:analista", "marco:neon", "banderin:emea-s1"],
  });
  for (const [family, id] of [
    ["titulo", "titulo:analista"], ["marco", "marco:neon"], ["banderin", "banderin:emea-s1"],
  ]) {
    await admin.rpc("app_equip_cosmetic", { p_user: userId, p_family: family, p_cosmetic_id: id });
  }

/*
 * MAESTRIA Y PRESTIGIO (Fase 14). Se completan DOS conjuntos pequenos concediendo sus
 * cartas con la RPC real, se cobran sus insignias con el servicio real y se compra un
 * escalon de prestigio con la RPC que cobra de verdad.
 *
 * Todo por el mismo camino que recorre un jugador: nada se escribe a mano en
 * `user_cosmetics` ni en `profiles`. Lo que se fotografia es el estado que produce el
 * juego, no uno colocado para la foto.
 */
{
  const { masterySets } = await import("@/domain/collection/mastery");
  const { claimMasteryTier } = await import("@/server/services/mastery");
  const { buyPrestige } = await import("@/server/services/prestige");

  const small = [...masterySets()]
    .filter((x) => x.axis === "equipo")
    .sort((a, b) => a.cardIds.length - b.cardIds.length)
    .slice(0, 2);

  for (const set of small) {
    await admin.rpc("app_grant_cards", {
      p_user: userId,
      p_instances: set.cardIds.map((cardId) => ({ cardId, serial: null })),
      p_mint_delta: {},
      p_origin: "admin",
    });
    await claimMasteryTier(admin, userId, set.id, 1);
  }
  // Un escalon comprado, para que la vitrina tenga contenido.
  if (small[0]) await buyPrestige(admin, userId, small[0].id, "plata");
}

await admin.from("profiles").update({ points: 940, region: "EMEA" }).eq("id", userId);
  return ids.length;
}

let shots = 0;

async function shoot(browser: Browser, name: string) {
  await browser.tab.shot(join(OUT, `${name}.png`));
  shots++;
  console.log(`  ✓ ${name}.png`);
}

/** Navega en cliente pulsando un enlace, como haría una persona. */
async function hop(browser: Browser, href: string, settle = 1800) {
  await browser.tab.js(`(() => {
    let a = [...document.querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === ${JSON.stringify(href)});
    if (!a) { a = document.createElement('a'); a.href = ${JSON.stringify(href)}; document.body.appendChild(a); }
    a.click();
  })()`);
  await sleep(settle);
}

async function main() {
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) {
    console.error(`❌ No hay servidor NEXUS en ${BASE}. Arranca 'npm run dev'.`);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const email = `visual-${Date.now()}@example.invalid`;
  const password = "Test-1234-visual";
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: "nexusplayer" },
  });
  if (error || !created.user) throw new Error(error?.message ?? "no se pudo crear el usuario");
  const userId = created.user.id;

  console.log(`# Capturas «${LABEL}» — ${BASE}`);
  const granted = await seed(admin, userId);
  console.log(`  · cuenta sembrada con ${granted} cartas, 5 sobres, 940 puntos\n`);

  const browser = await launch(WIDE);

  try {
    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;
    await browser.tab.goto(`${BASE}/`, 900);
    await browser.tab.setStorage(storageKey, JSON.stringify(signin!.session!));

    // ── Un mazo guardado, para que el constructor y la arena tengan contenido ──
    console.log("## Preparación");
    await browser.tab.goto(`${BASE}/duelos/mazos`, 3000);
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const B = () => [...document.querySelectorAll('button')];
      const nuevo = B().find((x) => /Crear mi primer mazo|\\+ Nuevo mazo/i.test(x.textContent));
      if (nuevo) { nuevo.click(); await s(1400); }
      const cards = () => B().filter((b) => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
      for (let i = 0; i < 30; i++) {
        const x = cards().find((b) => b.getAttribute('aria-pressed') === 'false');
        if (!x) break;
        x.click(); await s(70);
      }
      await s(500);
      return true;
    })()`);
    // Con el mazo a medias: el constructor con contenido es la captura que interesa.
    await shoot(browser, "04-constructor");
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const b = [...document.querySelectorAll('button')].find((x) => /Guardar mazo/i.test(x.textContent));
      if (b && !b.disabled) { b.click(); await s(2600); }
    })()`);
    console.log("  · mazo guardado");

    // ── Pantallas simples ──
    console.log("\n## Pantallas");
    for (const s of SCREENS) {
      await browser.tab.resize(WIDE.width, WIDE.height);
      await browser.tab.goto(`${BASE}${s.path}`, s.settle ?? 2600);
      await shoot(browser, s.name);
      if (s.phone) {
        await browser.tab.resize(PHONE.width, PHONE.height);
        await browser.tab.goto(`${BASE}${s.path}`, s.settle ?? 2600);
        await shoot(browser, `${s.name}-390`);
      }
    }
    await browser.tab.resize(WIDE.width, WIDE.height);

    // ── Estados que no son una ruta ──
    console.log("\n## Estados");

    // Modal de detalle de carta.
    await browser.tab.goto(`${BASE}/coleccion`, 3200);
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const grids = [...document.querySelectorAll('div')]
        .filter((d) => d.children.length >= 8 && [...d.children].every((c) => c.tagName === 'BUTTON'));
      const grid = grids.sort((a, b) => b.children.length - a.children.length)[0];
      if (!grid) return false;
      const card = [...grid.children].find((b) => !b.querySelector('.grayscale'));
      if (card) { card.click(); await s(1500); }
      return true;
    })()`);
    await shoot(browser, "09-carta-detalle");

    // Sobre sellado y su apertura.
    await browser.tab.goto(`${BASE}/abrir/premium`, 3000);
    await shoot(browser, "14-sobre-sellado");
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      /* La apertura se activa arrastrando sobre el sobre: se simula el gesto. */
      const el = document.querySelector('[class*="cursor"], main') || document.body;
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const down = new PointerEvent('pointerdown', { clientX: r.left + 40, clientY: y, bubbles: true, pointerId: 1 });
      el.dispatchEvent(down);
      for (let x = 40; x < r.width - 40; x += 20) {
        el.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + x, clientY: y, bubbles: true, pointerId: 1 }));
        await s(16);
      }
      el.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + r.width - 40, clientY: y, bubbles: true, pointerId: 1 }));
      await s(2600);
    })()`);
    await shoot(browser, "15-sobre-revelacion");

    /*
      ── El mercado entre jugadores ──
      La pestaña que abre `/mercado` es el mercado LOCAL contra bots, que existe desde
      antes. Lo que la Fase 11 reescribió es la pestaña «Global», así que hay que llegar
      hasta ella: capturar la de entrada sería fotografiar lo que no ha cambiado.
    */
    console.log("\n## Mercado entre jugadores");
    await browser.tab.goto(`${BASE}/mercado`, 3000);
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const b = [...document.querySelectorAll('button')].find((x) => /Global/i.test(x.textContent));
      if (b) { b.click(); await s(2200); }
    })()`);
    /*
      EL PANEL DE EVENTO EN VIVO (Fase 12).

      El vestibulo ya se fotografia en `01-inicio`, pero el panel queda por debajo del
      pliegue a 1440px y ahi no se ve lo que la fase ha anadido. Esta captura baja hasta el
      panel: los datos son los del evento REAL de la base de datos y el progreso lo calcula
      el servidor, asi que no hay nada colocado para la foto.
    */
    await browser.tab.goto(`${BASE}/`, 3000);
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const el = [...document.querySelectorAll("section")].find(
        (x) => x.getAttribute("aria-label") === "Evento en vivo");
      if (el) { el.scrollIntoView({ block: "center" }); await s(1200); }
    })()`);
    await shoot(browser, "01b-inicio-evento");

    /*
      MAESTRIA DE COLECCION (Fase 13).

      Va al final de `/coleccion`, debajo de las cartas y del progreso por region, asi que
      hay que bajar hasta ella. Los conjuntos y el progreso los calcula el servidor contra
      `user_cards`: lo que se fotografia es la coleccion sembrada de verdad, no un estado
      colocado para la foto.
    */
    await browser.tab.goto(`${BASE}/coleccion`, 3600);
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const el = [...document.querySelectorAll("section")].find(
        (x) => x.getAttribute("aria-label") === "Maestría de colección");
      if (el) { el.scrollIntoView({ block: "start" }); await s(1400); }
    })()`);
    await shoot(browser, "08b-coleccion-maestria");

    /*
      PRESTIGIO (Fase 14). El sumidero, justo debajo de la maestria. Se baja hasta el.
      La vitrina tiene contenido porque la siembra compro un escalon con la RPC real.
    */
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const el = [...document.querySelectorAll("section")].find(
        (x) => x.getAttribute("aria-label") === "Prestigio");
      if (el) { el.scrollIntoView({ block: "start" }); await s(1400); }
    })()`);
    await shoot(browser, "08c-coleccion-prestigio");

    /*
      DESAFIOS POR PARTIDO (Fase 13).

      Las preguntas de RESULTADO EXACTO van despues de todas las de ganador —si se
      intercalaran habria que leer dos veces cada fila para saber que se pregunta—, asi que
      quedan al final de la pagina. Se baja hasta la primera que ofrece marcadores.
    */
    await browser.tab.goto(`${BASE}/pickems`, 3200);
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const el = [...document.querySelectorAll("*")].find(
        (x) => x.children.length === 0 && /con que resultado|con qu. resultado/i.test(x.textContent || ""));
      if (el) { el.scrollIntoView({ block: "center" }); await s(1200); }
      else { window.scrollTo(0, document.body.scrollHeight); await s(1200); }
    })()`);
    await shoot(browser, "21b-pickems-resultado");

    await shoot(browser, "12b-mercado-global");

    /*
      Y el escaparate CON CONTENIDO.

      Con el comercio cerrado no publica nadie, así que el estado real es el vacío de
      arriba — pero entonces no se ve cómo se presenta una carta en venta, que es justo lo
      que la Fase 11 escribió. Los listados se crean con la RPC REAL (`app_market_list`),
      no insertando filas a mano: lo que se fotografía es el mercado de verdad con datos de
      verdad. Se retiran justo después para no dejar listados fantasma en el entorno.
    */
    const { listCard, cancelListing } = await import("@/server/services/market");
    // Seis ejemplares cualesquiera del inventario sembrado. Se retiran al terminar, así
    // que da igual cuáles sean: lo que se fotografía es la presentación, no el contenido.
    const { data: dupRows } = await admin
      .from("user_cards").select("uid, card_id").eq("user_id", userId).eq("locked", false).limit(6);
    const toList = ((dupRows ?? []) as { uid: string; card_id: string }[]);

    const created: string[] = [];
    for (const [i, row] of toList.entries()) {
      const r = await listCard(admin, userId, row.uid, 400 + i * 350, `shots:${Date.now()}:${i}`);
      if (r.ok) created.push(r.data.listingId);
    }

    if (created.length > 0) {
      await browser.tab.goto(`${BASE}/mercado`, 3000);
      await browser.tab.js(`(async () => {
        const s = (ms) => new Promise((r) => setTimeout(r, ms));
        const b = [...document.querySelectorAll('button')].find((x) => /Global/i.test(x.textContent));
        if (b) { b.click(); await s(2400); }
      })()`);
      await shoot(browser, "12c-mercado-escaparate");
      for (const id of created) await cancelListing(admin, userId, id);
    }

    /*
      ── La ceremonia, con movimiento ──
      Aparte del juego comparable y con su propio nombre. Se activa `no-preference` para
      que las animaciones corran de verdad y se apaga después, para que el resto del
      recorrido siga capturándose en las mismas condiciones que el juego «antes».
    */
    console.log("\n## Ceremonia (con movimiento)");
    await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await browser.tab.goto(`${BASE}/abrir/premium`, 900);
    await shoot(browser, "34-ceremonia-llegada");
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      await s(900);
      const b = [...document.querySelectorAll('button')].find((x) => /Abrir sobre/i.test(x.textContent));
      if (b) b.click();
      await s(700);
    })()`);
    await shoot(browser, "35-ceremonia-rotura");
    await browser.tab.js(`(() => new Promise((r) => setTimeout(r, 1400)))()`);
    await shoot(browser, "36-ceremonia-revelacion");
    await browser.tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);

    // ── La arena: se juega una partida de verdad ──
    console.log("\n## Arena");
    await browser.tab.goto(`${BASE}/duelos/jugar`, 3000);
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const b = [...document.querySelectorAll('button')].find((x) => /Comenzar duelo/i.test(x.textContent));
      if (b && !b.disabled) { b.click(); await s(3200); }
    })()`);
    await shoot(browser, "06-arena-turno1");

    // Unos turnos para llegar a la revelación y al resultado.
    await browser.tab.js(`(async () => {
      const TURNS = 3;
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const B = () => [...document.querySelectorAll('button')];
      /*
        conf() NO exige !disabled al buscar: el botón de confirmar EXISTE siempre y empieza
        deshabilitado («Elige una carta»). Filtrar por habilitado al buscarlo hacía que el
        bucle saliera en la primera vuelta sin jugar nada. Es el mismo bucle que usa
        'duel:e2e', que sí completa la partida.
        (Sin comillas invertidas: este bloque vive DENTRO de una plantilla de JS.)
      */
      const conf = () => B().find((x) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(x.textContent.trim()));
      const cont = () => B().find((x) => x.textContent.trim() === 'Continuar');
      const cards = () => B().filter((b) => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
      for (let i = 0; i < TURNS; i++) {
        const c0 = cont(); if (c0) { c0.click(); await s(420); }
        if (!conf()) break;
        const cs = cards(); if (cs.length === 0) break;
        cs[0].click(); await s(260);
        const st = B().filter((x) => !x.getAttribute('aria-label') && /^(SH|GS|EF)/.test(x.textContent.trim()));
        if (st.length === 3) { st[0].click(); await s(260); }
        const c = conf(); if (!c || c.disabled) break;
        c.click(); await s(1500);
      }
    })()`);
    await shoot(browser, "07-arena-reveal");

    // Terminar la partida para capturar el resultado.
    await browser.tab.js(`(async () => {
      const TURNS = 14;
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const B = () => [...document.querySelectorAll('button')];
      /*
        conf() NO exige !disabled al buscar: el botón de confirmar EXISTE siempre y empieza
        deshabilitado («Elige una carta»). Filtrar por habilitado al buscarlo hacía que el
        bucle saliera en la primera vuelta sin jugar nada. Es el mismo bucle que usa
        'duel:e2e', que sí completa la partida.
        (Sin comillas invertidas: este bloque vive DENTRO de una plantilla de JS.)
      */
      const conf = () => B().find((x) => /^(Elige una carta|Elige una estadística|Declarar y atacar|Responder)$/.test(x.textContent.trim()));
      const cont = () => B().find((x) => x.textContent.trim() === 'Continuar');
      const cards = () => B().filter((b) => /OVR \\d+$/.test(b.getAttribute('aria-label') || ''));
      for (let i = 0; i < TURNS; i++) {
        const c0 = cont(); if (c0) { c0.click(); await s(420); }
        if (!conf()) break;
        const cs = cards(); if (cs.length === 0) break;
        cs[0].click(); await s(260);
        const st = B().filter((x) => !x.getAttribute('aria-label') && /^(SH|GS|EF)/.test(x.textContent.trim()));
        if (st.length === 3) { st[0].click(); await s(260); }
        const c = conf(); if (!c || c.disabled) break;
        c.click(); await s(1500);
      }
      const last = cont(); if (last) { last.click(); await s(1200); }
    })()`);
    await shoot(browser, "32-resultado");

    // Repetición.
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const b = [...document.querySelectorAll('button')].find((x) => /Ver la partida/i.test(x.textContent));
      if (b) { b.click(); await s(3200); }
    })()`);
    await shoot(browser, "33-replay");

    console.log(`\n${shots} capturas en docs/product/visual/${LABEL}/`);
  } finally {
    await browser.close();
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
