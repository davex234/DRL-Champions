/**
 * AUDITORÍA DE ESTABILIDAD — toda la aplicación, en un navegador de verdad.
 *
 *   npm run dev              (en otra terminal)
 *   npm run audit:stability  [--shots] [--anon]
 *
 * Recorre TODAS las rutas con Chrome y comprueba lo que ningún test unitario ve:
 *
 *   · Runtime Errors (excepciones sin capturar, incluido `enqueueModel`).
 *   · Errores de consola y avisos de hidratación.
 *   · Peticiones fallidas (5xx, y 4xx que no sean esperados).
 *   · Pantallas en blanco y componentes que no llegan a montar.
 *   · El árbol de error de Next (`next-error-h1`, overlay de desarrollo).
 *
 * Se ejecuta DOS VECES por ruta cuando hace falta: con sesión y sin ella, porque media
 * aplicación cambia de rama según haya usuario, y un fallo en la rama anónima no se ve
 * nunca si solo se prueba con la cuenta cargada.
 *
 * No arregla nada: solo mide. El informe sale ordenado por severidad.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";

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
const SHOTS = process.argv.includes("--shots");
const OUT = join(ROOT, "docs", "product", "audit");

/* ─────────────────────────── Rutas ─────────────────────────── */

interface RouteSpec {
  path: string;
  name: string;
  /** `both` prueba con sesión y sin ella. */
  auth: "session" | "anon" | "both";
  /** Rutas de administración: solo se comprueba que no revientan al montar. */
  admin?: boolean;
  /** Se salta el armazón (launcher). */
  bare?: boolean;
}

const ROUTES: RouteSpec[] = [
  { path: "/", name: "inicio", auth: "both" },

  // Duelos
  { path: "/duelos", name: "duelos", auth: "both" },
  { path: "/duelos/jugar", name: "duelos-jugar", auth: "session" },
  { path: "/duelos/mazos", name: "duelos-mazos", auth: "session" },

  // Competición
  { path: "/torneos", name: "torneos", auth: "both" },
  { path: "/pickems", name: "pickems", auth: "both" },
  { path: "/eventos", name: "eventos", auth: "session" },

  // Entrenador
  { path: "/entrenador", name: "entrenador", auth: "both" },
  { path: "/entrenador/equipos", name: "entrenador-equipos", auth: "session" },
  { path: "/entrenador/mapas", name: "entrenador-mapas", auth: "both" },
  { path: "/entrenador/strats", name: "entrenador-strats", auth: "session" },
  { path: "/entrenador/partido", name: "entrenador-partido", auth: "session" },
  { path: "/carrera", name: "carrera", auth: "session" },
  { path: "/manager", name: "manager", auth: "session" },

  // Colección
  { path: "/coleccion", name: "coleccion", auth: "both" },
  { path: "/colecciones", name: "colecciones", auth: "session" },
  { path: "/inventario", name: "inventario", auth: "session" },
  { path: "/mercado", name: "mercado", auth: "session" },

  // Tienda
  { path: "/tienda", name: "tienda", auth: "both" },

  // Progreso
  { path: "/cuenta", name: "cuenta", auth: "both" },
  { path: "/ranking", name: "ranking", auth: "both" },
  { path: "/logros", name: "logros", auth: "both" },
  { path: "/recompensas", name: "recompensas", auth: "session" },

  // Mundo
  { path: "/mundo", name: "mundo", auth: "session" },
  { path: "/noticias", name: "noticias", auth: "session" },

  // Cliente aparte
  { path: "/launcher", name: "launcher", auth: "anon", bare: true },

  // Administración
  { path: "/admin", name: "admin", auth: "session", admin: true },
  { path: "/admin/assets", name: "admin-assets", auth: "session", admin: true },
  { path: "/admin/card-review", name: "admin-card-review", auth: "session", admin: true },
  { path: "/admin/control", name: "admin-control", auth: "session", admin: true },
  { path: "/admin/data-engine", name: "admin-data-engine", auth: "session", admin: true },
  { path: "/admin/live", name: "admin-live", auth: "session", admin: true },
  { path: "/admin/releases", name: "admin-releases", auth: "session", admin: true },
  { path: "/admin/torneos", name: "admin-torneos", auth: "session", admin: true },
  { path: "/admin/tournament-control", name: "admin-tournament-control", auth: "session", admin: true },
];

/* ─────────────────────────── Datos del usuario ─────────────────────────── */

/**
 * Da al usuario de la auditoría CARTAS, SOBRES, CRÉDITOS y un MAZO.
 *
 * Hasta aquí la auditoría recorría la aplicación con una cuenta recién creada, y eso deja
 * fuera la mitad del código: una rejilla de colección vacía no monta ni una carta, un
 * inventario sin sobres no monta el arte del sobre, y el constructor sin cartas no llega
 * a pintar la lista. Los componentes que fallan al montar suelen ser justo esos.
 *
 * Se usa la MISMA RPC que el juego (`app_grant_cards`), no un INSERT a mano: así lo que se
 * prueba es el estado que produce el propio juego.
 */
async function seedUser(admin: SupabaseClient, userId: string): Promise<string[]> {
  const notes: string[] = [];

  try {
    const { CardRegistry } = await import("@/collection/registry");
    const { DUEL_ROLES } = await import("@/domain/cardgame");
    const registry = new CardRegistry();

    // Dos cartas por rol: exactamente un mazo de duelo legal.
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

    const { error } = await admin.rpc("app_grant_cards", {
      p_user: userId,
      p_instances: ids.map((cardId) => ({ cardId, serial: null })),
      p_mint_delta: {},
      p_origin: "admin",
    });
    notes.push(error ? `cartas: ${error.message}` : `${ids.length} cartas`);
  } catch (e) {
    notes.push(`cartas: ${e instanceof Error ? e.message : "error"}`);
  }

  // Sobres y saldo, por la ruta de recompensas del servidor.
  const { error: rewardErr } = await admin.rpc("app_grant_reward", {
    p_user: userId,
    p_ref: `audit-seed:${userId}`,
    p_reason: "admin",
    p_credits: 25_000,
    p_xp: 1500,
    p_pack_id: "estandar",
    p_pack_count: 3,
  });
  notes.push(rewardErr ? `recompensa: ${rewardErr.message}` : "créditos, XP, fichas y 3 sobres");

  // Puntos competitivos: abre el rango, la clasificación y el carril competitivo del pase.
  const { error: ptsErr } = await admin
    .from("profiles").update({ points: 620, region: "EMEA" }).eq("id", userId);
  notes.push(ptsErr ? `puntos: ${ptsErr.message}` : "620 puntos y región EMEA");

  return notes;
}

/* ─────────────────────────── Rutas dinámicas ─────────────────────────── */

/**
 * Las rutas con parámetro no se pueden listar: hay que darles un identificador que
 * exista. Se resuelven de datos REALES —el catálogo de sobres, las colecciones y la base
 * de datos— porque una ruta dinámica probada con un id inventado solo demuestra que la
 * pantalla de "no encontrado" funciona.
 *
 * Además de la variante con id válido se prueba una con id INEXISTENTE: una ruta dinámica
 * que revienta con un parámetro desconocido es un fallo tan real como una que revienta con
 * uno bueno, y es el caso que llega por un enlace viejo.
 */
async function dynamicRoutes(admin: SupabaseClient, userId: string): Promise<RouteSpec[]> {
  const out: RouteSpec[] = [];

  // Sobres: del catálogo estático del juego.
  const { PACKS } = await import("@/data/packs");
  const pack = PACKS.find((p) => !p.eventId);
  if (pack) out.push({ path: `/abrir/${pack.id}`, name: `abrir-${pack.id}`, auth: "session" });
  out.push({ path: "/abrir/no-existe", name: "abrir-inexistente", auth: "session" });

  // Colecciones: se leen las que la propia aplicación conoce.
  try {
    const { mergedCollections } = await import("@/lib/collections/repos");
    const defs = await mergedCollections();
    if (defs[0]) out.push({ path: `/colecciones/${defs[0].slug ?? defs[0].id}`, name: "coleccion-slug", auth: "session" });
  } catch { /* si no se puede resolver, se prueba solo el caso inexistente */ }
  out.push({ path: "/colecciones/no-existe", name: "coleccion-slug-inexistente", auth: "session" });

  /*
   * Torneos: la tabla es `events`, no `tournaments`. La primera versión de esta sonda
   * consultaba `tournaments` —que existe, pero es la de la simulación interna— y no
   * devolvía nada, así que la ruta con id VÁLIDO no se llegaba a probar nunca.
   */
  const { data: t } = await admin.from("events").select("id").limit(1).maybeSingle();
  if (t) out.push({ path: `/torneos/${(t as { id: string }).id}`, name: "torneo-id", auth: "both" });
  out.push({
    path: "/torneos/00000000-0000-4000-8000-000000000000",
    name: "torneo-inexistente",
    auth: "session",
  });

  // Repeticiones de duelo: una partida terminada de cualquier usuario sirve para
  // comprobar que la pantalla monta; el servidor decidirá si la enseña o no.
  const { data: m } = await admin
    .from("duel_matches").select("id").in("status", ["COMPLETED", "DRAW", "UNRESOLVED"])
    .limit(1).maybeSingle();
  if (m) {
    out.push({
      path: `/duelos/replay/${(m as { id: string }).id}`,
      name: "duelo-replay",
      auth: "session",
    });
  }
  out.push({
    path: "/duelos/replay/00000000-0000-4000-8000-000000000000",
    name: "duelo-replay-inexistente",
    auth: "session",
  });

  return out;
}

/* ─────────────────────────── Hallazgos ─────────────────────────── */

type Severity = "P0" | "P1" | "P2";

interface Finding {
  route: string;
  mode: string;
  severity: Severity;
  kind: string;
  detail: string;
}

const findings: Finding[] = [];
let checks = 0;

function report(route: string, mode: string, severity: Severity, kind: string, detail: string) {
  findings.push({ route, mode, severity, kind, detail: detail.slice(0, 400) });
}

/* ─────────────────────────── Sondas ─────────────────────────── */

interface Probe {
  bodyText: number;
  hasShell: boolean;
  nextError: string | null;
  overlay: string | null;
  title: string;
  url: string;
  html: number;
}

const PROBE = `(() => {
  const de = document.documentElement;
  /* El overlay de errores de Next en desarrollo: si está, hay un Runtime Error. */
  const portal = document.querySelector('nextjs-portal');
  let overlay = null;
  if (portal && portal.shadowRoot) {
    /*
      \`shadowRoot.textContent\` incluye la HOJA DE ESTILO del portal, que está siempre y no
      significa nada: leerla entera daba 35 falsos positivos, uno por ruta. Lo que delata
      un Runtime Error es el cuerpo del diálogo de error, no el portal.
    */
    const dialog = portal.shadowRoot.querySelector(
      '[data-nextjs-dialog-body], [data-nextjs-error-message], [data-nextjs-dialog-header], .nextjs-container-errors-header'
    );
    const t = dialog ? (dialog.textContent || '') : '';
    if (t.trim().length > 0) overlay = t.replace(/\\s+/g, ' ').trim().slice(0, 400);
  }
  const h1 = document.querySelector('#__next_error__, [data-nextjs-error]');
  return {
    bodyText: (document.body.innerText || '').trim().length,
    hasShell: !!document.querySelector('header.nx-chrome') || !!document.querySelector('[data-context]'),
    nextError: h1 ? (h1.textContent || '').slice(0, 200) : null,
    overlay,
    title: document.title,
    url: location.pathname,
    html: de.outerHTML.length,
  };
})()`;

/** Nombre de la excepción sin el ruido del stack, para agrupar. */
const shortError = (e: string) => e.split("\n")[0].slice(0, 200);

/**
 * ¿Es este error una excepción real del código o ruido conocido del entorno?
 *
 * Los 404 de imagen son arte que falta en el catálogo (documentado en la Fase 9J) y la
 * aplicación ya los sustituye. Contarlos como Runtime Error taparía los que sí importan.
 */
function classify(text: string): { ignore: boolean; severity: Severity; kind: string } {
  const t = text.toLowerCase();
  if (/failed to load resource.*404/.test(t) && !/\.js|\.css|_next/.test(t)) {
    return { ignore: true, severity: "P2", kind: "arte-ausente" };
  }
  if (/enqueuemodel/.test(t)) return { ignore: false, severity: "P0", kind: "rsc-flight" };
  if (/hydrat/.test(t)) return { ignore: false, severity: "P1", kind: "hidratacion" };
  if (/is not a function|is not defined|cannot read propert|undefined is not/.test(t)) {
    return { ignore: false, severity: "P0", kind: "runtime" };
  }
  if (/failed to load resource.*(50\d)/.test(t)) return { ignore: false, severity: "P0", kind: "peticion-5xx" };
  if (/failed to load resource/.test(t)) return { ignore: false, severity: "P2", kind: "peticion" };
  return { ignore: false, severity: "P1", kind: "consola" };
}

async function visit(tab: Tab, spec: RouteSpec, mode: string) {
  checks++;
  tab.takeErrors();
  await tab.goto(`${BASE}${spec.path}`, 2800);

  const probe = await tab.js<Probe>(PROBE);

  /*
   * Se drena en DOS tiempos. Un `fetch` con temporizador de 4 s —o una violación de CSP,
   * que el navegador informa de forma asíncrona— puede llegar después de que la sonda
   * haya leído la página, y entonces el error se apuntaba a la ruta SIGUIENTE. Pasó con
   * la comprobación del servidor de actualizaciones del launcher, que aparecía atribuida
   * a `/torneos/[id]`, y costó un rato entender por qué.
   */
  const errors = tab.takeErrors();
  await sleep(600);
  errors.push(...tab.takeErrors());

  // Runtime Errors y consola.
  const seen = new Set<string>();
  for (const e of errors) {
    const c = classify(e);
    if (c.ignore) continue;
    const key = `${c.kind}:${shortError(e)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    report(spec.path, mode, c.severity, c.kind, shortError(e));
  }

  // El overlay de Next en desarrollo es prueba directa de Runtime Error.
  if (probe.overlay) {
    report(spec.path, mode, "P0", "overlay-next", probe.overlay);
  }
  if (probe.nextError) {
    report(spec.path, mode, "P0", "error-boundary", probe.nextError);
  }

  // Pantalla en blanco.
  if (probe.bodyText < 40) {
    report(spec.path, mode, "P0", "pantalla-blanca", `solo ${probe.bodyText} caracteres visibles`);
  }

  // El armazón tiene que estar en todo lo que no sea el launcher.
  if (!spec.bare && !probe.hasShell) {
    report(spec.path, mode, "P1", "sin-armazon", "no se encontró el armazón de la aplicación");
  }

  if (SHOTS) await tab.shot(join(OUT, `${spec.name}-${mode}.png`));

  return probe;
}

/* ─────────────────────────── Interacciones ─────────────────────────── */

/**
 * Pulsa los controles principales de la pantalla y comprueba que nada revienta.
 *
 * Se evitan a propósito los que navegan fuera o son destructivos: lo que se prueba aquí
 * es que un componente no explota al INTERACTUAR, no el recorrido completo —de eso ya se
 * encargan `duel:e2e` y los `*-verify`.
 */
async function poke(tab: Tab, spec: RouteSpec) {
  const before = tab.takeErrors().length;

  const clicked = await tab.js<number>(`(async () => {
    const s = (ms) => new Promise((r) => setTimeout(r, ms));
    const safe = [...document.querySelectorAll('button:not([disabled])')]
      .filter((b) => {
        const t = (b.textContent || '').trim();
        if (t.length === 0 || t.length > 40) return false;
        /* Nada destructivo ni que empiece una partida o gaste saldo. */
        if (/borrar|eliminar|vender|comprar|abrir sobre|abandonar|cerrar sesi|reclamar|guardar|comenzar|desbloquear|instalar/i.test(t)) return false;
        return b.offsetParent !== null;
      })
      .slice(0, 8);
    for (const b of safe) { b.click(); await s(220); }
    return safe.length;
  })()`);

  await sleep(700);
  const errors = tab.takeErrors();
  for (const e of errors) {
    const c = classify(e);
    if (c.ignore) continue;
    report(spec.path, "interacción", c.severity, c.kind, shortError(e));
  }
  return { clicked, newErrors: errors.length - before };
}

/* ─────────────────────────── Navegación de cliente ─────────────────────────── */

/**
 * Recorre la aplicación **pulsando enlaces**, no recargando.
 *
 * Es la diferencia que importa. Una carga dura trae la carga RSC incrustada en el HTML;
 * una navegación de cliente la PIDE por separado (`?_rsc=`) y la parsea el router con el
 * cliente Flight. Errores como `chunk.reason.enqueueModel is not a function` viven ahí y
 * son invisibles para un arnés que solo hace `Page.navigate` —que era exactamente el
 * punto ciego de la primera versión de esta auditoría.
 *
 * Se recorre en cadena, sin recargar entre saltos, para que el router acumule caché,
 * prefetch e historial: es donde aparecen los fallos de streaming.
 */
async function clientWalk(tab: Tab, path: string[], label: string) {
  const visited: { to: string; ok: boolean; text: number }[] = [];

  for (const target of path) {
    checks++;
    const before = tab.takeErrors();
    for (const e of before) {
      const c = classify(e);
      if (!c.ignore) report(label, "nav-cliente", c.severity, c.kind, shortError(e));
    }

    /*
      Se navega SIEMPRE pulsando un `<a>` que Next intercepte. Si no hay enlace visible al
      destino, se inyecta uno y se pulsa.
      
      Lo que NO vale: `history.pushState` + `popstate`. La primera versión de esta fase lo
      usaba como respaldo y el App Router lo ignora, así que la página no cambiaba y la
      auditoría daba por buenas veinticinco rutas mirando siempre la misma. Se detectó
      porque rutas distintas devolvían el MISMO número de caracteres.
    */
    await tab.js(`(() => {
      const href = ${JSON.stringify(target)};
      let a = [...document.querySelectorAll('a[href]')].find((x) => x.getAttribute('href') === href);
      if (!a) {
        a = document.createElement('a');
        a.href = href;
        a.textContent = 'audit';
        a.setAttribute('data-audit-link', '1');
        document.body.appendChild(a);
      }
      a.click();
    })()`);

    await sleep(2600);

    const probe = await tab.js<Probe>(PROBE);

    /*
      La comprobación que impide que esta fase mienta: si el router no llegó al destino,
      todo lo que se mida después es de OTRA pantalla y no vale como aprobado.
    */
    if (probe.url !== target) {
      report(target, "nav-cliente", "P1", "navegacion",
        `pulsar el enlace no llevó a ${target}; se quedó en ${probe.url}`);
      visited.push({ to: target, ok: false, text: probe.bodyText });
      continue;
    }
    const errors = tab.takeErrors();
    const seen = new Set<string>();
    for (const e of errors) {
      const c = classify(e);
      if (c.ignore) continue;
      const key = `${c.kind}:${shortError(e)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      report(target, "nav-cliente", c.severity, c.kind, shortError(e));
    }
    if (probe.overlay) report(target, "nav-cliente", "P0", "overlay-next", probe.overlay);
    if (probe.bodyText < 40) {
      report(target, "nav-cliente", "P0", "pantalla-blanca", `solo ${probe.bodyText} caracteres`);
    }

    visited.push({ to: target, ok: probe.bodyText >= 40, text: probe.bodyText });
  }

  return visited;
}

/**
 * Atrás y adelante del navegador. El router de Next restaura desde su caché, y una carga
 * RSC mal cacheada se manifiesta justo aquí y no en la ida.
 */
async function historyWalk(tab: Tab, steps: number) {
  for (let i = 0; i < steps; i++) {
    await tab.js("history.back()");
    await sleep(1300);
    const errors = tab.takeErrors();
    for (const e of errors) {
      const c = classify(e);
      if (!c.ignore) report("(atrás)", "historial", c.severity, c.kind, shortError(e));
    }
  }
  for (let i = 0; i < steps; i++) {
    await tab.js("history.forward()");
    await sleep(1300);
    const errors = tab.takeErrors();
    for (const e of errors) {
      const c = classify(e);
      if (!c.ignore) report("(adelante)", "historial", c.severity, c.kind, shortError(e));
    }
  }
}

/* ─────────────────────────── Principal ─────────────────────────── */

async function main() {
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) {
    console.error(`❌ No hay servidor NEXUS en ${BASE}. Arranca 'npm run dev' primero.`);
    process.exit(1);
  }
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const email = `audit-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: "auditor" },
  });
  if (error || !created.user) throw new Error(error?.message ?? "no se pudo crear el usuario");
  const userId = created.user.id;

  const browser = await launch({ width: 1440, height: 900 });
  const { tab } = browser;

  try {
    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const session = signin!.session!;
    const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

    // Datos reales en la cuenta: sin ellos, media aplicación se prueba vacía.
    const seeded = await seedUser(admin, userId);
    for (const n of seeded) console.log(`  · sembrado: ${n}`);

    // Las dinámicas se resuelven ahora, con datos reales, y se suman al recorrido.
    const dynamic = await dynamicRoutes(admin, userId);
    ROUTES.push(...dynamic);

    console.log(`# Auditoría de estabilidad — ${BASE}`);
    console.log(`  ${ROUTES.length} rutas (${dynamic.length} dinámicas) · usuario de prueba ${email}\n`);

    // ── Pasada 1 · SIN sesión ──
    console.log("## Sin sesión (rama anónima)");
    await tab.goto(`${BASE}/`, 500);
    await tab.js(`localStorage.clear()`);
    for (const spec of ROUTES.filter((r) => r.auth === "anon" || r.auth === "both")) {
      const p = await visit(tab, spec, "anónimo");
      console.log(`  · ${spec.path.padEnd(28)} ${String(p.bodyText).padStart(6)} car.`);
    }

    // ── Pasada 2 · CON sesión ──
    console.log("\n## Con sesión");
    await tab.goto(`${BASE}/`, 600);
    await tab.setStorage(storageKey, JSON.stringify(session));
    for (const spec of ROUTES.filter((r) => r.auth !== "anon")) {
      const p = await visit(tab, spec, "sesión");
      console.log(`  · ${spec.path.padEnd(28)} ${String(p.bodyText).padStart(6)} car.`);
    }

    // ── Pasada 3 · interacciones en las pantallas del núcleo ──
    console.log("\n## Interacciones");
    const interactive = ROUTES.filter(
      (r) => !r.admin && !r.bare && r.auth !== "anon",
    );
    for (const spec of interactive) {
      await tab.goto(`${BASE}${spec.path}`, 2400);
      const r = await poke(tab, spec);
      console.log(`  · ${spec.path.padEnd(28)} ${r.clicked} control(es)`);
    }

    // ── Pasada 4 · navegación DE CLIENTE, que es como navega un usuario ──
    console.log("\n## Navegación de cliente (enlaces, sin recargar)");
    const circuit = [
      "/", "/duelos", "/duelos/mazos", "/torneos", "/pickems",
      "/entrenador", "/entrenador/mapas", "/entrenador/strats", "/entrenador/equipos",
      "/coleccion", "/colecciones", "/inventario", "/mercado",
      "/tienda", "/eventos", "/cuenta", "/ranking", "/logros", "/recompensas",
      "/mundo", "/noticias", "/carrera", "/manager", "/entrenador", "/",
    ];
    await tab.goto(`${BASE}/`, 2600);
    const walked = await clientWalk(tab, circuit, "circuito");
    for (const v of walked) {
      console.log(`  · ${v.to.padEnd(28)} ${v.ok ? "ok" : "VACÍA"} (${v.text})`);
    }

    // ── Pasada 5 · historial ──
    console.log("\n## Atrás / adelante");
    await historyWalk(tab, 6);
    console.log("  · 6 pasos atrás y 6 adelante");

    // ── Pasada 6 · el circuito otra vez, con la caché del router ya caliente ──
    console.log("\n## Segunda vuelta (caché del router caliente)");
    const again = await clientWalk(tab, circuit, "circuito-2");
    const vacias = again.filter((v) => !v.ok).length;
    console.log(`  · ${again.length} saltos · ${vacias} pantalla(s) vacía(s)`);
  } finally {
    await browser.close();
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  /* ─────────────────────────── Informe ─────────────────────────── */

  console.log(`\n${"─".repeat(70)}`);
  const p0 = findings.filter((f) => f.severity === "P0");
  const p1 = findings.filter((f) => f.severity === "P1");
  const p2 = findings.filter((f) => f.severity === "P2");

  for (const [label, list] of [["P0 · bloqueantes", p0], ["P1 · importantes", p1], ["P2 · menores", p2]] as const) {
    if (list.length === 0) continue;
    console.log(`\n## ${label} (${list.length})`);
    // Se agrupan por mensaje: el mismo fallo en veinte rutas es UN bug, no veinte.
    const byDetail = new Map<string, Finding[]>();
    for (const f of list) {
      const k = `${f.kind} · ${f.detail}`;
      byDetail.set(k, [...(byDetail.get(k) ?? []), f]);
    }
    for (const [k, group] of byDetail) {
      const routes = [...new Set(group.map((g) => g.route))];
      console.log(`  ✕ ${k}`);
      console.log(`      en ${routes.length} ruta(s): ${routes.slice(0, 8).join(", ")}${routes.length > 8 ? "…" : ""}`);
    }
  }

  const json = join(ROOT, "docs", "product", "audit-stability.json");
  mkdirSync(dirname(json), { recursive: true });
  writeFileSync(json, JSON.stringify({ base: BASE, checks, findings }, null, 2));

  console.log(`\n${"─".repeat(70)}`);
  console.log(`Comprobaciones: ${checks} · P0: ${p0.length} · P1: ${p1.length} · P2: ${p2.length}`);
  console.log(`Detalle completo en docs/product/audit-stability.json`);
  console.log(p0.length === 0 && p1.length === 0 ? "\n✅ SIN FALLOS BLOQUEANTES NI IMPORTANTES" : "\n❌ HAY FALLOS QUE CORREGIR");
  process.exit(p0.length === 0 && p1.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
