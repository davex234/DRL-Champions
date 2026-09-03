/**
 * VERIFICACIÓN DE EXPERIENCIA — Fase 9.
 *
 *   npm run dev          (en otra terminal)
 *   npm run ux:verify    [--shots]
 *
 * Recorre TODAS las pantallas del producto en tres anchos (390 / 768 / 1440) con un usuario
 * real y comprueba lo que un test unitario no puede ver:
 *
 *   · que la página no se desborda en horizontal (el fallo nº 1 en móvil),
 *   · que el armazón está donde debe: barra superior en escritorio, barra inferior en móvil,
 *   · que las zonas táctiles llegan al mínimo utilizable,
 *   · que no hay errores de consola ni peticiones caídas,
 *   · que el tinte de contexto (`data-context`) cambia con la sección.
 *
 * Con `--shots` guarda además un PNG de cada pantalla en `docs/product/ux/`.
 *
 * Sale con código 1 si algo falla, como el resto de scripts `*-verify` del proyecto.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep } from "./lib/cdp";
import { NAV_SECTIONS } from "@/design/nav";

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
const OUT = join(ROOT, "docs", "product", "ux");
const SHOTS = process.argv.includes("--shots");

/** Las pantallas del producto, con la sección a la que deben pertenecer. */
const ROUTES: { path: string; name: string; context: string | null }[] = [
  { path: "/", name: "inicio", context: null },
  { path: "/duelos", name: "duelos", context: "jugar" },
  { path: "/duelos/mazos", name: "duelos-mazos", context: "jugar" },
  { path: "/torneos", name: "torneos", context: "jugar" },
  { path: "/pickems", name: "pickems", context: "jugar" },
  { path: "/entrenador", name: "entrenador", context: "jugar" },
  { path: "/entrenador/equipos", name: "entrenador-equipos", context: "jugar" },
  { path: "/entrenador/mapas", name: "entrenador-mapas", context: "jugar" },
  { path: "/entrenador/strats", name: "entrenador-strats", context: "jugar" },
  { path: "/coleccion", name: "coleccion", context: "coleccion" },
  { path: "/colecciones", name: "colecciones", context: "coleccion" },
  { path: "/inventario", name: "inventario", context: "coleccion" },
  { path: "/mercado", name: "mercado", context: "coleccion" },
  { path: "/tienda", name: "tienda", context: "tienda" },
  { path: "/eventos", name: "eventos", context: "tienda" },
  { path: "/cuenta", name: "cuenta", context: "progreso" },
  { path: "/ranking", name: "ranking", context: "progreso" },
  { path: "/logros", name: "logros", context: "progreso" },
  { path: "/recompensas", name: "recompensas", context: "progreso" },
  { path: "/mundo", name: "mundo", context: "mundo" },
  { path: "/noticias", name: "noticias", context: "mundo" },
];

/** Los cinco anchos que la Fase 9J exige verificar. */
const VIEWPORTS: { w: number; h: number; tag: string }[] = [
  { w: 1920, h: 1080, tag: "1920" },
  { w: 1440, h: 900, tag: "1440" },
  { w: 1024, h: 768, tag: "1024" },
  { w: 768, h: 1024, tag: "768" },
  { w: 390, h: 844, tag: "390" },
];

/*
 * Con `--shots` se guarda un PNG de cada pantalla, y cinco anchos × 22 pantallas son 110
 * imágenes. Para revisarlas a ojo bastan tres: el móvil, la tableta y el escritorio.
 */
const SHOT_WIDTHS = new Set(["390", "768", "1440"]);

let failures = 0;
/** Huecos de ARTE detectados (no cuentan como fallo). Se resumen al final. */
const artGaps: string[] = [];
function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✕"} ${label}${detail && !ok ? ` — ${detail}` : ""}`);
}

async function main() {
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) {
    console.error(`❌ No hay servidor NEXUS en ${BASE}. Arranca 'npm run dev' primero.`);
    process.exit(1);
  }
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const email = `ux-${Date.now()}@example.invalid`;
  const password = "Test-1234-ux";
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: "uxcheck" },
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

    // La sesión hay que dejarla en el origen de la aplicación, no en about:blank.
    await tab.goto(`${BASE}/`, 800);
    await tab.setStorage(storageKey, JSON.stringify(session));

    console.log(`# Verificación de experiencia — ${BASE}\n`);

    for (const vp of VIEWPORTS) {
      console.log(`\n── ${vp.w}×${vp.h} ──`);
      await tab.resize(vp.w, vp.h);

      for (const route of ROUTES) {
        // 2400 ms: la pantalla de arranque dura 1300 ms más medio segundo de fundido.
        await tab.goto(`${BASE}${route.path}`, 2400);

        const report = await tab.js<{
          overflow: number;
          hasTop: boolean;
          hasMobileBar: boolean;
          context: string | null;
          smallTargets: number;
          smallWho: string[];
          title: string;
          bodyText: number;
          nodes: number;
          loadMs: number;
        }>(`(() => {
          const de = document.documentElement;
          /*
            Dos varas de medir, porque son dos cosas distintas:
              · CONTROL — algo que se ve como un botón: tiene borde, fondo o es un <button>.
                Mínimo 32 px de alto. Por debajo, el dedo falla.
              · ENLACE DE TEXTO — una palabra subrayada dentro de una frase. Exigirle 32 px
                rompería el párrafo; se le pide 22, que es lo que mide una línea de texto.
            Medirlo todo con la vara del control marcaba como defecto la tipografía normal.
          */
          const tinyEls = [...document.querySelectorAll('a,button,[role="button"]')].filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            // Un control deshabilitado no se puede pulsar: no es una zona táctil.
            if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
            const cs = getComputedStyle(el);
            // Un enlace con display inline está DENTRO de una frase: su alto lo marca la
            // línea de texto, y estirarlo rompería el párrafo. Se exime.
            if (cs.display === 'inline') return false;
            const hasBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
            const hasBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0;
            const isControl = el.tagName === 'BUTTON' || hasBg || hasBorder;
            return r.height < (isControl ? 32 : 22);
          });
          const tiny = tinyEls.length;
          const tinyWho = [...new Set(tinyEls.map((el) => {
            const r = el.getBoundingClientRect();
            return ((el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24))
              + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
          }))].slice(0, 6);
          return {
            overflow: de.scrollWidth - de.clientWidth,
            hasTop: !!document.querySelector('header.nx-chrome'),
            // Visible de verdad, no solo presente en el DOM: la barra inferior existe
            // siempre y se oculta con \`lg:hidden\`, así que medirla es lo único fiable.
            hasMobileBar: (() => {
              const n = document.querySelector('nav.nx-chrome');
              return !!n && n.getBoundingClientRect().height > 0;
            })(),
            context: (document.querySelector('[data-context]')||{}).getAttribute
              ? document.querySelector('[data-context]').getAttribute('data-context') : null,
            smallTargets: tiny,
            smallWho: tinyWho,
            title: document.title,
            bodyText: document.body.innerText.trim().length,
            nodes: document.getElementsByTagName('*').length,
            loadMs: Math.round((performance.getEntriesByType('navigation')[0] || {}).duration || 0),
          };
        })()`);

        const label = `${route.name} @${vp.tag}`;

        /*
         * Los errores de consola solo se comprueban en UN ancho: son los mismos en los
         * cinco (el código no cambia con el viewport) y repetirlos cinco veces solo haría
         * más largo el informe. En los demás anchos se vacía el buffer para que no
         * arrastre nada a la siguiente pantalla.
         */
        const errors = tab.takeErrors();
        if (vp.tag === "1440") {
          /*
           * Los 404 de imagen se cuentan aparte, y a propósito: son ARTE QUE FALTA en el
           * catálogo (fotos de jugador, escudos), no un defecto del código. La aplicación
           * ya los maneja —desde la Fase 8.5 hay una caché negativa que evita pedir dos
           * veces la misma imagen ausente y enseña el sustituto—, así que fallar el gate
           * por ellos convertiría un hueco de contenido en un fallo de calidad y taparía
           * los errores que sí importan.
           */
          const missingArt = errors.filter((e) => /404/.test(e));
          const real = errors.filter((e) => !/404/.test(e));
          check(real.length === 0, `${label} · sin errores de consola`, real.slice(0, 2).join(" | "));
          if (missingArt.length > 0) {
            artGaps.push(`${route.name}: ${missingArt.length}`);
          }
        }

        check(report.overflow <= 1, `${label} · sin desbordamiento horizontal`, `${report.overflow}px de más`);
        check(report.hasTop, `${label} · barra superior presente`);
        check(report.bodyText > 60, `${label} · la pantalla tiene contenido`, `${report.bodyText} caracteres`);
        if (route.context !== null) {
          check(report.context === route.context, `${label} · contexto «${route.context}»`, `es «${report.context}»`);
        }
        /*
         * El corte está en `lg`, que en Tailwind es 1024 px INCLUIDO: a 1024 exactos manda
         * ya la barra superior y la inferior desaparece.
         */
        if (vp.w < 1024) {
          check(report.hasMobileBar, `${label} · barra inferior visible en móvil/tablet`);
          /*
           * Zonas táctiles. El mínimo cómodo son 44 px; se exige 32 porque por debajo de
           * eso el dedo falla de verdad, y porque hay chips y contadores que no son
           * objetivos primarios. Un fallo aquí nombra el elemento, no solo el número.
           */
          check(
            report.smallTargets === 0,
            `${label} · todas las zonas táctiles llegan a 32 px`,
            `${report.smallTargets} por debajo: ${report.smallWho.join(" · ")}`,
          );
        } else {
          check(!report.hasMobileBar, `${label} · sin barra inferior en escritorio`);
        }

        // Peso de la página. No es una métrica de belleza: por encima de ~4000 nodos el
        // desplazamiento empieza a notarse en un móvil de gama media.
        if (vp.tag === "1440") {
          check(report.nodes < 4000, `${label} · menos de 4000 nodos en el DOM`, `${report.nodes}`);
        }

        if (SHOTS && SHOT_WIDTHS.has(vp.tag)) await tab.shot(join(OUT, `${route.name}-${vp.tag}.png`));
      }
    }

    // El menú de secciones tiene que abrirse también con teclado, no solo con el ratón.
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}/`, 1400);
    // React procesa el `onFocus` en su propio ciclo: hay que dar un respiro antes de leer
    // el estado, o se comprueba el DOM anterior al re-render.
    await tab.js(`(() => {
      const link = [...document.querySelectorAll('header nav a')].find(a => a.textContent.trim() === 'Jugar');
      if (link) link.focus();
    })()`);
    await sleep(400);
    const keyboard = await tab.js<{ expanded: boolean; items: number }>(`(() => {
      const link = [...document.querySelectorAll('header nav a')].find(a => a.textContent.trim() === 'Jugar');
      const id = link && link.getAttribute('aria-controls');
      const panel = id ? document.getElementById(id) : null;
      return {
        expanded: !!link && link.getAttribute('aria-expanded') === 'true',
        items: panel ? panel.querySelectorAll('a').length : 0,
      };
    })()`);
    check(keyboard.expanded, "el menú de sección se abre con el foco de teclado");
    // El número sale de la tabla, no de una constante escrita a mano: así el test sigue
    // valiendo cuando la sección gana o pierde un destino.
    const jugar = NAV_SECTIONS.find((s) => s.id === "jugar")!;
    check(
      keyboard.items === jugar.items.length,
      `el desplegable de «Jugar» ofrece sus ${jugar.items.length} destinos`,
      `${keyboard.items}`,
    );
  } finally {
    await browser.close();
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(`\n${failures === 0 ? "✅ PASA" : `❌ ${failures} comprobaciones fallidas`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
