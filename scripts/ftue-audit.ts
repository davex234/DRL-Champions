/**
 * AUDITORÍA DE PRIMERA EXPERIENCIA (FTUE) — NEXUS (Fase 15).
 *
 *   npm run ftue:audit
 *   npm run ftue:audit -- --shots docs/product/visual/fase15-antes
 *
 * ────────────────────────── QUÉ ES ──────────────────────────
 *
 * Una herramienta de AUDITORÍA. No verifica que las cosas funcionen —para eso están
 * `ux:verify` y `audit:interactions`— sino que responde a una pregunta distinta y que hasta
 * ahora no medía nadie:
 *
 *   «Una persona que nunca ha visto NEXUS entra. ¿Sabe qué hacer?»
 *
 * Para eso crea una cuenta REAL y recién registrada —sin sembrar nada: los 6.000 créditos y
 * los cuatro sobres que da `handle_new_user`, y nada más— y recorre el camino que recorrería
 * esa persona, anotando en cada pantalla lo único que importa aquí:
 *
 *   · Qué le PROPONE el juego (la tira «Qué hacer ahora»), y en qué orden.
 *   · Si la pantalla a la que llega tiene algo que hacer o está vacía.
 *   · Si el texto que la trajo coincide con lo que se encuentra.
 *
 * La cuenta se borra al terminar. Esto no cambia nada del producto.
 *
 * ────────────────────────── POR QUÉ UNA CUENTA NUEVA ──────────────────────────
 *
 * Todas las verificaciones y capturas anteriores usan cuentas SEMBRADAS: 86 cartas, 940
 * puntos, cinco sobres. Con eso el producto se ve muy bien y no se detecta ni uno de los
 * problemas de primera vez, porque el jugador sembrado ya ha superado todos.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, type Browser } from "./lib/cdp";

const ROOT = process.cwd();
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

const args = process.argv.slice(2);
const shotsDir = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

interface Finding { level: "P0" | "P1" | "P2" | "P3"; where: string; what: string }
const findings: Finding[] = [];
const note = (level: Finding["level"], where: string, what: string) => {
  findings.push({ level, where, what });
  console.log(`    [${level}] ${what}`);
};

/** Texto visible de la página, aplanado. Sirve para saber qué lee una persona. */
const TEXT = `(() => document.body.innerText.replace(/\\s+/g, " ").trim())()`;

/** Los pasos de la tira «Qué hacer ahora», en el orden en que se le ofrecen. */
const NEXT_UP = `(() => {
  const s = [...document.querySelectorAll('section')]
    .find((x) => x.getAttribute('aria-label') === 'Qué hacer ahora');
  if (!s) return null;
  return [...s.querySelectorAll('a')].map((a) => ({
    label: (a.querySelector('span span') || a).innerText.split('\\n')[0].trim(),
    href: a.getAttribute('href'),
    detail: a.innerText.split('\\n').slice(-1)[0].trim(),
  }));
})()`;

/**
 * Cuántos botones ACCIONABLES hay: una pantalla sin ninguno es un callejón.
 *
 * NO se acota a `<main>`. `GameShell` tiene RUTAS INMERSIVAS —jugar un duelo, abrir un
 * sobre— que se renderizan a propósito sin cromo y, por tanto, sin `<main>`. Medir dentro
 * de `main` daba cero acciones en esas rutas y hacía parecer un callejón sin salida lo que
 * era un estado vacío perfectamente resuelto. Se descuenta la barra de navegación, que está
 * en todas partes y no es una salida de la pantalla.
 */
const ACTIONS = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const chrome = (el) => !!el.closest('header, nav, [data-nav], footer');
  const b = [...document.querySelectorAll('button, a[href]')]
    .filter((x) => vis(x) && !x.disabled && !chrome(x));
  return b.length;
})()`;

async function shot(browser: Browser, name: string): Promise<void> {
  if (!shotsDir) return;
  mkdirSync(join(ROOT, shotsDir), { recursive: true });
  await browser.tab.shot(join(ROOT, shotsDir, `${name}.png`));
}

async function main() {
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) {
    console.error(`❌ No hay servidor NEXUS en ${BASE}. Arranca 'npm run dev' primero.`);
    process.exit(1);
  }

  console.log("# Auditoría de PRIMERA EXPERIENCIA — NEXUS (Fase 15)\n");
  console.log("Cuenta recién registrada. Sin sembrar. Lo que ve una persona el primer día.\n");

  const stamp = Date.now();
  const email = `ftue-${stamp}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `nuevo${stamp}` },
  });
  if (error || !created.user) throw new Error(error?.message ?? "no se pudo crear el usuario");
  const userId = created.user.id;

  const browser = await launch({ width: 1440, height: 900 });

  try {
    // Lo que `handle_new_user` concede, tal cual, sin tocarlo.
    const { data: prof } = await admin.from("profiles")
      .select("credits, level, points, distinct_cards").eq("id", userId).maybeSingle();
    const { data: packs } = await admin.from("user_packs")
      .select("pack_id, qty").eq("user_id", userId);
    const { count: cards } = await admin.from("user_cards")
      .select("uid", { count: "exact", head: true }).eq("user_id", userId);

    console.log("## 0 · CON QUÉ EMPIEZA");
    console.log(`  perfil: ${JSON.stringify(prof)}`);
    console.log(`  sobres: ${JSON.stringify(packs)}`);
    console.log(`  cartas: ${cards}\n`);

    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin } = await pub.auth.signInWithPassword({ email, password });
    const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;
    await browser.tab.goto(`${BASE}/`, 900);
    await browser.tab.setStorage(storageKey, JSON.stringify(signin!.session!));

    // ══════════════════════════════════════════════════════════════════
    console.log("## 1 · EL VESTÍBULO: ¿QUÉ LE DICE EL JUEGO QUE HAGA?");
    // ══════════════════════════════════════════════════════════════════
    await browser.tab.goto(`${BASE}/`, 4000);
    await shot(browser, "01-lobby-nuevo");

    const steps = await browser.tab.js<{ label: string; href: string; detail: string }[] | null>(NEXT_UP);
    if (!steps || steps.length === 0) {
      note("P0", "/", "el vestíbulo NO propone nada a un jugador nuevo");
    } else {
      steps.forEach((s, i) => console.log(`    ${i + 1}. ${s.label}  →  ${s.href}`));
      console.log(`       («${steps[0].detail}»)`);

      /*
       * LA PREGUNTA DE LA FASE: ¿lo PRIMERO que se le propone a alguien que no tiene ni una
       * carta tiene sentido para él? Predecir un torneo de Valorant antes de haber visto una
       * carta es una petición razonable para quien vuelve y desconcertante para quien entra.
       */
      const first = steps[0];
      if (first.href === "/pickems") {
        note("P1", "/", `lo PRIMERO que se le ofrece es «${first.label}» (Pick'ems) sin tener ni una carta`);
      }

      // Coherencia entre lo que dice un paso y adónde lleva.
      for (const s of steps) {
        if (/abriendo un sobre|abre .*sobre/i.test(s.detail) && s.href === "/tienda") {
          note("P1", "/", `«${s.label}» dice «${s.detail}» pero lleva a /tienda (comprar), no a /inventario (abrir)`);
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 2 · LAS PANTALLAS A LAS QUE LE MANDAN");
    // ══════════════════════════════════════════════════════════════════
    const routes: { path: string; name: string; expect: RegExp; why: string }[] = [
      { path: "/inventario", name: "02-inventario", expect: /sobre/i, why: "sus 4 sobres sin abrir" },
      { path: "/coleccion", name: "03-coleccion", expect: /carta|colecci/i, why: "su colección vacía" },
      { path: "/duelos/mazos", name: "04-mazos", expect: /mazo|equipo/i, why: "construir el primer equipo" },
      { path: "/duelos/jugar", name: "05-jugar", expect: /duelo|mazo|jugar/i, why: "jugar sin mazo" },
      { path: "/tienda", name: "06-tienda", expect: /sobre/i, why: "comprar" },
      { path: "/pickems", name: "07-pickems", expect: /predicci|pick/i, why: "predecir" },
      { path: "/logros", name: "08-progreso", expect: /pase|nivel|misi/i, why: "su progreso" },
      { path: "/cuenta", name: "09-perfil", expect: /nivel|rango/i, why: "su identidad" },
    ];

    for (const r of routes) {
      await browser.tab.goto(`${BASE}${r.path}`, 3200);
      await shot(browser, r.name);
      const text = await browser.tab.js<string>(TEXT);
      const actions = await browser.tab.js<number>(ACTIONS);
      const errs = browser.tab.takeErrors();

      console.log(`  ${r.path.padEnd(16)} ${String(actions).padStart(3)} acciones · ${text.length} car.`);

      if (text.length < 120) {
        note("P0", r.path, `pantalla casi vacía (${text.length} caracteres) — llegó buscando ${r.why}`);
      } else if (!r.expect.test(text)) {
        note("P1", r.path, `no menciona lo que venía a hacer (${r.why})`);
      }
      /*
       * CERO acciones es un callejón. UNA no lo es.
       *
       * La primera versión de esto marcaba `<= 1` y señalaba dos pantallas que están BIEN:
       * el constructor sin mazos y la preparación del duelo sin mazo válido son estados
       * vacíos resueltos, con su explicación y exactamente UNA salida clara. Un estado vacío
       * que ofrece una sola cosa que hacer es buen diseño, no un problema — señalarlo era
       * inventar un defecto.
       */
      if (actions === 0) {
        note("P1", r.path, "callejón sin salida: ninguna acción disponible");
      }
      if (errs.length > 0) {
        /*
         * Qué recurso falla exactamente: un 404 sin URL no se puede arreglar.
         *
         * Las fotos de jugador (`/players/*.png`) se tratan aparte y como P3. No son un
         * defecto del producto: `PlayerPhoto` tiene respaldo y recuerda las que faltan para
         * no reintentarlas. Lo que ocurre es que este entorno no ha descargado el artwork
         * —`public/players/` está vacío—, y eso lo resuelve el pipeline de artwork, no una
         * corrección de interfaz. Marcarlo como P1 sería confundir contenido con código.
         */
        /*
         * Qué recurso ha fallado, leído del registro de RENDIMIENTO en vez de instrumentando
         * `fetch`: la instrumentación se instala antes de navegar y la navegación la borra,
         * así que nunca veía nada. `performance` sobrevive a la carga y trae el estado.
         */
        const detalle = await browser.tab.js<string[]>(`(() => performance
          .getEntriesByType('resource')
          .filter((e) => e.responseStatus === 404)
          .map((e) => new URL(e.name).pathname)
          .slice(0, 4))()`);
        const soloFotos = detalle.length > 0 && detalle.every((u) => /\/players\//.test(u));
        note(
          soloFotos ? "P3" : "P1",
          r.path,
          soloFotos
            ? `faltan ${detalle.length}+ fotos de jugador (artwork sin descargar; hay respaldo visual)`
            : `error de consola: ${errs[0].slice(0, 90)}${detalle?.length ? " → " + detalle.join(", ") : ""}`,
        );
      }
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 3 · ¿PUEDE LLEGAR A JUGAR UN DUELO?");
    // ══════════════════════════════════════════════════════════════════
    /*
     * El camino crítico: con 0 cartas y 4 sobres, ¿el producto le lleva de la mano hasta la
     * primera partida? Se mira si la pantalla de jugar le DICE qué le falta, en vez de
     * enseñarle un botón apagado sin motivo.
     */
    await browser.tab.goto(`${BASE}/duelos/jugar`, 3200);
    const jugarText = await browser.tab.js<string>(TEXT);
    const explica = /mazo|diez cartas|10 cartas|necesitas|abre|construye/i.test(jugarText);
    console.log(`    ¿explica por qué no puede jugar?  ${explica ? "sí" : "NO"}`);
    if (!explica) note("P1", "/duelos/jugar", "no explica que hace falta un mazo antes de poder jugar");

    // Tampoco aquí se acota a `main`: es una ruta inmersiva (ver `ACTIONS`).
    const linkSalida = await browser.tab.js<string | null>(`(() => {
      const a = [...document.querySelectorAll('a[href]')]
        .find((x) => /mazo|inventario|sobre|tienda/i.test(x.getAttribute('href') || ''));
      return a ? a.getAttribute('href') : null;
    })()`);
    console.log(`    ¿ofrece el camino para arreglarlo?  ${linkSalida ?? "NO"}`);
    if (!linkSalida) note("P1", "/duelos/jugar", "no ofrece ningún enlace para conseguir un mazo");

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 3 bis · EL CONSTRUCTOR CON CERO CARTAS");
    // ══════════════════════════════════════════════════════════════════
    /*
     * El paso mas delicado del camino: el constructor invita a «crear mi primer mazo», pero
     * este jugador no tiene ni una carta —las suyas siguen dentro de cuatro sobres sin
     * abrir—. Se pulsa el boton y se mira que se encuentra. Si le deja en una rejilla vacia
     * sin decirle que antes tiene que abrir los sobres, es un callejon con buena pinta.
     */
    await browser.tab.goto(`${BASE}/duelos/mazos`, 3000);
    await browser.tab.js(`(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms));
      const b = [...document.querySelectorAll('button')]
        .find((x) => /Crear mi primer (?:mazo|equipo)|Nuevo (?:mazo|equipo)/i.test(x.textContent || ''));
      if (b) { b.click(); await s(1800); }
      return !!b;
    })()`);
    await shot(browser, "04b-mazos-vacio");
    const builderText = await browser.tab.js<string>(TEXT);
    const guia = /abre|sobre|inventario|tienda|consigue|no tienes cartas/i.test(builderText);
    console.log(`    ¿dice que primero hay que abrir los sobres?  ${guia ? "si" : "NO"}`);
    console.log(`    texto: «${builderText.slice(0, 180)}»`);
    if (!guia) {
      note("P1", "/duelos/mazos", "el constructor con CERO cartas no dice que primero hay que abrir los sobres");
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 4 · LA COLECCIÓN VACÍA");
    // ══════════════════════════════════════════════════════════════════
    await browser.tab.goto(`${BASE}/coleccion`, 3600);
    const colText = await browser.tab.js<string>(TEXT);
    const diceQueHacer = /abre|sobre|tienda|consigue|empieza/i.test(colText.slice(0, 900));
    console.log(`    ¿dice cómo conseguir la primera carta?  ${diceQueHacer ? "sí" : "NO"}`);
    if (!diceQueHacer) {
      note("P1", "/coleccion", "una colección vacía no dice cómo conseguir la primera carta");
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 5 · MÓVIL (390)");
    // ══════════════════════════════════════════════════════════════════
    await browser.tab.resize(390, 844, 2);
    await browser.tab.goto(`${BASE}/`, 3600);
    await shot(browser, "10-lobby-390");
    const overflow = await browser.tab.js<number>(
      `(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)()`);
    console.log(`    desbordamiento horizontal: ${overflow}px`);
    if (overflow > 2) note("P1", "/ @390", `la portada desborda ${overflow}px en horizontal`);
  } finally {
    await browser.close().catch(() => {});
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log("\n" + "=".repeat(72));
  const byLevel = (l: string) => findings.filter((f) => f.level === l);
  for (const l of ["P0", "P1", "P2", "P3"] as const) {
    const list = byLevel(l);
    if (list.length === 0) continue;
    console.log(`\n${l} · ${list.length}`);
    for (const f of list) console.log(`  · ${f.where.padEnd(18)} ${f.what}`);
  }
  console.log(
    findings.length === 0
      ? "\n✅ UN JUGADOR NUEVO SABE QUÉ HACER"
      : `\n${byLevel("P0").length} P0 · ${byLevel("P1").length} P1 · ${byLevel("P2").length} P2`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
