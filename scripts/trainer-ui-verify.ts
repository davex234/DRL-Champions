/**
 * VERIFICACIÓN DE LA UI DEL ENTRENADOR — `npm run trainer:verify`
 *
 *   npm run build && npx next start -p 3005     (en otra terminal)
 *   E2E_BASE_URL=http://127.0.0.1:3005 npm run trainer:verify
 *
 * `maps:verify` comprueba los ficheros y `strats:verify` la frontera HTTP. Esto comprueba
 * lo único que no se puede comprobar sin pintar: **que el mapa se ve bien**.
 *
 * ────────────────────────── QUÉ SE MIDE, Y POR QUÉ ASÍ ──────────────────────────
 *
 *   · **Deformación.** No se mira una captura: se compara la proporción NATURAL de cada
 *     PNG con la proporción a la que el navegador lo está pintando. Un mapa estirado da un
 *     número distinto, y un número no se discute.
 *   · **Alineación de las capas.** Se inyectan tres sondas en coordenadas conocidas, se
 *     mide la distancia entre ellas, se hace zoom y se vuelve a medir. Si las capas siguen
 *     alineadas, las tres distancias tienen que escalar por el MISMO factor. Si alguna
 *     capa se moviera por su cuenta, las razones se separarían.
 *   · **Que el PNG no se toca.** Los atributos del `<image>` antes y después del zoom.
 *   · **Desbordamiento horizontal** a 390 px, que es donde se rompe todo.
 *
 * La sesión se inyecta en `localStorage`, igual que hacen `stability-audit` y `ftue-audit`:
 * aquí no se teclea ninguna contraseña en ningún formulario.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch } from "./lib/cdp";
import { TACTICAL_MAPS, getTacticalMap, aspectRatio } from "@/domain/tactics";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_ || !ANON || !SERVICE) {
  console.error("Faltan credenciales de Supabase en .env.local");
  process.exit(1);
}

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

async function main(): Promise<void> {
  console.log(`# Verificación de la UI del ENTRENADOR — ${BASE}\n`);

  const ping = await fetch(`${BASE}/entrenador/mapas`).catch(() => null);
  if (!ping?.ok) {
    console.error(`No hay servidor en ${BASE}. Arranca \`npx next start -p 3005\` y repite.`);
    process.exit(1);
  }

  // ── Cuenta de usar y tirar, con sesión inyectada (sin teclear contraseñas) ──
  const email = `trainer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error: e1 } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { username: `trainer${Date.now().toString(36)}` },
  });
  if (e1 || !created.user) throw new Error(e1?.message ?? "no se pudo crear la cuenta");
  const userId = created.user.id;

  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signin } = await pub.auth.signInWithPassword({ email, password });
  const session = signin!.session!;
  const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

  const browser = await launch();
  const tab = browser.tab;

  try {
    // ══════════════════════════════════════════════════════════════════
    console.log("## 1 · LOS DOCE MAPAS SE CARGAN Y NINGUNO SE DEFORMA");
    // ══════════════════════════════════════════════════════════════════
    /*
     * Caché del navegador FUERA. El perfil de Chrome del helper es persistente, así que
     * entre dos builds se queda con el HTML viejo de una ruta y pide un chunk que ya no
     * existe: la página no hidrata y la pizarra dice «necesitas una cuenta» con la sesión
     * puesta. Medir una build contra el caché de otra no mide nada.
     */
    await tab.send("Network.enable");
    await tab.send("Network.setCacheDisabled", { cacheDisabled: true });

    await tab.resize(1600, 1000);

    /*
     * PURGA DEL SERVICE WORKER. NEXUS registra uno para funcionar sin conexión, y entre dos
     * builds sirve el HTML viejo: el navegador acaba pidiendo un chunk que ya no existe y
     * la página no llega a hidratar. Costó un rato entender por qué la pizarra decía
     * «necesitas una cuenta» con la sesión puesta en `localStorage`.
     *
     * Se purga aquí y no en el producto: el service worker está bien: lo que no vale es
     * medir una build contra el caché de otra.
     */
    await tab.goto(`${BASE}/`, 1200);
    await tab.js(`(async () => {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      return true;
    })()`);
    await tab.goto(`${BASE}/entrenador/mapas`, 2600);

    // Las miniaturas van con carga diferida: se recorre la lista para que entren en pantalla.
    await tab.js(`
      document.querySelectorAll('img[src^="/maps/"]').forEach(i => i.loading = "eager");
      null`);
    await tab.js(`new Promise(r => setTimeout(r, 1800))`);

    const thumbs = await tab.js<{ src: string; nw: number; nh: number; rw: number; rh: number; fit: string }[]>(`
      [...document.querySelectorAll('img[src^="/maps/"]')].map(i => {
        const b = i.getBoundingClientRect();
        return { src: i.getAttribute("src"), nw: i.naturalWidth, nh: i.naturalHeight,
                 rw: b.width, rh: b.height, fit: getComputedStyle(i).objectFit };
      })`);

    check("el selector enseña los doce mapas", thumbs.length === 12, `${thumbs.length}`);
    check("los doce assets se descargan sin fallar",
      thumbs.every((t) => t.nw > 0 && t.nh > 0),
      thumbs.filter((t) => !t.nw).map((t) => t.src).join(", ") || "todos");

    const declaradas = thumbs.filter((t) => {
      const id = t.src.replace("/maps/", "").replace(".png", "");
      const m = getTacticalMap(id);
      return m && (m.width !== t.nw || m.height !== t.nh);
    });
    check("las dimensiones reales coinciden con las del catálogo", declaradas.length === 0,
      declaradas.map((t) => t.src).join(", "));

    /*
     * La comprobación de deformación. Se compara la proporción natural con la pintada, con
     * una tolerancia del 1,5 % que absorbe el redondeo del navegador. Un `object-fit: cover`
     * o un contenedor cuadrado darían un error de decenas de puntos, no de decimales.
     */
    const torcidas = thumbs
      .filter((t) => t.rw > 4 && t.rh > 4)
      .map((t) => ({ src: t.src, nat: t.nw / t.nh, ren: t.rw / t.rh }))
      .filter((t) => Math.abs(t.nat - t.ren) / t.nat > 0.015);
    check("NINGUNA miniatura se pinta deformada", torcidas.length === 0,
      torcidas.map((t) => `${t.src} ${t.nat.toFixed(3)}→${t.ren.toFixed(3)}`).join(" · "));
    check("las miniaturas usan `contain`, nunca `cover`",
      thumbs.every((t) => t.fit === "contain"),
      [...new Set(thumbs.map((t) => t.fit))].join(", "));

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 2 · EL TABLERO RESPETA EL MAPA");
    // ══════════════════════════════════════════════════════════════════
    const base = await tab.js<{ href: string; w: string; h: string; x: string; y: string; vb: string; par: string }>(`
      (() => {
        const svg = document.querySelector('svg[role="application"]');
        const im = svg.querySelector("image");
        return { href: im.getAttribute("href"), w: im.getAttribute("width"), h: im.getAttribute("height"),
                 x: im.getAttribute("x") ?? "0", y: im.getAttribute("y") ?? "0",
                 vb: svg.getAttribute("viewBox"), par: svg.getAttribute("preserveAspectRatio") };
      })()`);

    const ascent = getTacticalMap("ascent")!;
    check("la capa base es el PNG del mapa", base.href === "/maps/ascent.png", base.href);
    check("se pinta ENTERO y en su tamaño real, sin recortar",
      Number(base.w) === ascent.width && Number(base.h) === ascent.height
      && Number(base.x) === 0 && Number(base.y) === 0,
      `${base.w}×${base.h} @${base.x},${base.y}`);
    check("el `viewBox` es el encuadre medido del mapa, no un cuadrado universal",
      base.vb === `${ascent.frame.x} ${ascent.frame.y} ${ascent.frame.width} ${ascent.frame.height}`,
      base.vb);
    check("el lienzo ajusta sin deformar (`meet`)", base.par === "xMidYMid meet", base.par);

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 3 · ZOOM Y ALINEACIÓN DE CAPAS");
    // ══════════════════════════════════════════════════════════════════
    const z = await tab.js<{
      vbAntes: string; vbDespues: string; imgAntes: string; imgDespues: string;
      razones: number[]; centroFijo: number;
    }>(`
      (async () => {
        const svg = document.querySelector('svg[role="application"]');
        const im = svg.querySelector("image");
        const NS = "http://www.w3.org/2000/svg";
        const W = Number(im.getAttribute("width")), H = Number(im.getAttribute("height"));
        const attrs = () => im.getAttribute("width") + "x" + im.getAttribute("height")
          + "@" + (im.getAttribute("x") ?? 0) + "," + (im.getAttribute("y") ?? 0);

        const sondas = [[50,50],[10,90],[90,10]].map(([gx,gy]) => {
          const c = document.createElementNS(NS, "circle");
          c.setAttribute("cx", (gx/100)*W); c.setAttribute("cy", (gy/100)*H);
          c.setAttribute("r", 4); c.setAttribute("fill", "none");
          svg.appendChild(c); return c;
        });
        const medir = () => sondas.map(c => { const b = c.getBoundingClientRect();
          return { x: b.x + b.width/2, y: b.y + b.height/2 }; });

        const imgAntes = attrs(), vbAntes = svg.getAttribute("viewBox"), antes = medir();
        const mas = [...document.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === "Acercar");
        mas.click(); mas.click();
        await new Promise(r => setTimeout(r, 320));
        const imgDespues = attrs(), vbDespues = svg.getAttribute("viewBox"), despues = medir();
        sondas.forEach(c => c.remove());

        const d = (p,q) => Math.hypot(p.x-q.x, p.y-q.y);
        const razones = [[0,1],[0,2],[1,2]].map(([a,b]) => d(despues[a],despues[b]) / d(antes[a],antes[b]));
        return { vbAntes, vbDespues, imgAntes, imgDespues, razones,
                 centroFijo: Math.hypot(despues[0].x-antes[0].x, despues[0].y-antes[0].y) };
      })()`);

    check("el zoom mueve la CÁMARA (cambia el viewBox)", z.vbAntes !== z.vbDespues,
      `${z.vbAntes} → ${z.vbDespues}`);
    check("y NO toca el PNG: el `<image>` queda igual", z.imgAntes === z.imgDespues,
      `${z.imgAntes} → ${z.imgDespues}`);

    const media = z.razones.reduce((a, b) => a + b, 0) / z.razones.length;
    const dispersion = Math.max(...z.razones.map((r) => Math.abs(r - media)));
    check("las capas escalan TODAS por el mismo factor (siguen alineadas)",
      dispersion < 0.002 && media > 1.05,
      `factores ${z.razones.map((r) => r.toFixed(4)).join(", ")}`);
    check("el zoom no desplaza el centro de la vista", z.centroFijo < 4,
      `${z.centroFijo.toFixed(2)} px`);

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 4 · CAMBIAR DE MAPA SOLO CAMBIA EL ASSET");
    // ══════════════════════════════════════════════════════════════════
    const cambio = await tab.js<{ href: string; vb: string; w: string; h: string }>(`
      (async () => {
        const b = [...document.querySelectorAll('[role="radio"]')]
          .find(x => x.textContent.trim().startsWith("Lotus"));
        b.click();
        await new Promise(r => setTimeout(r, 700));
        const svg = document.querySelector('svg[role="application"]');
        const im = svg.querySelector("image");
        return { href: im.getAttribute("href"), vb: svg.getAttribute("viewBox"),
                 w: im.getAttribute("width"), h: im.getAttribute("height") };
      })()`);

    const lotus = getTacticalMap("lotus")!;
    check("al elegir otro mapa cambia el asset", cambio.href === "/maps/lotus.png", cambio.href);
    check("y con SUS dimensiones reales, no las del anterior",
      Number(cambio.w) === lotus.width && Number(cambio.h) === lotus.height,
      `${cambio.w}×${cambio.h}`);
    check("la cámara se reencuadra al mapa nuevo",
      cambio.vb === `${lotus.frame.x} ${lotus.frame.y} ${lotus.frame.width} ${lotus.frame.height}`,
      cambio.vb);
    check("los doce mapas no comparten proporción (no hay ninguno normalizado a cuadrado)",
      new Set(TACTICAL_MAPS.map((m) => aspectRatio(m).toFixed(4))).size >= 10);

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 5 · LA PIZARRA CON SESIÓN");
    // ══════════════════════════════════════════════════════════════════
    await tab.goto(`${BASE}/`, 700);
    await tab.setStorage(storageKey, JSON.stringify(session));
    await tab.goto(`${BASE}/entrenador/strats`, 3000);

    const pizarra = await tab.js<{
      svg: boolean; image: string | null; capas: number; fichas: number;
      radios: number; pasos: number; utilidades: number;
    }>(`
      (() => {
        const svg = document.querySelector('svg[role="application"]');
        const im = svg?.querySelector("image");
        return {
          svg: !!svg,
          image: im?.getAttribute("href") ?? null,
          capas: svg ? [...svg.children].filter(n => n.tagName === "g").length : 0,
          fichas: svg ? svg.querySelectorAll('g[role="button"]').length : 0,
          radios: document.querySelectorAll('[role="radio"]').length,
          pasos: [...document.querySelectorAll("button")].filter(b => /^\\d+\\./.test(b.textContent.trim())).length,
          utilidades: [...document.querySelectorAll("button")].filter(b => b.getAttribute("aria-label")).length,
        };
      })()`);

    check("la pizarra monta el tablero", pizarra.svg && !!pizarra.image, pizarra.image ?? "sin imagen");
    check("hay cuatro capas de interacción sobre el mapa", pizarra.capas === 4, `${pizarra.capas}`);
    check("nace con los cinco jugadores colocados", pizarra.fichas >= 5, `${pizarra.fichas} fichas`);
    check("el selector de mapa ofrece los doce", pizarra.radios === 12, `${pizarra.radios}`);
    check("la secuencia arranca con un paso", pizarra.pasos >= 1, `${pizarra.pasos}`);

    // ── Añadir un paso y comprobar que hereda el estado ──
    const secuencia = await tab.js<{ pasos: number; fichasPaso2: number }>(`
      (async () => {
        const mas = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "+ Paso");
        mas.click();
        await new Promise(r => setTimeout(r, 500));
        const svg = document.querySelector('svg[role="application"]');
        return {
          pasos: [...document.querySelectorAll("button")].filter(b => /^\\d+\\./.test(b.textContent.trim())).length,
          fichasPaso2: svg.querySelectorAll('g[role="button"]').length,
        };
      })()`);
    check("añadir un paso lo añade a la secuencia", secuencia.pasos >= 2, `${secuencia.pasos}`);
    check("y el paso nuevo hereda las fichas del anterior", secuencia.fichasPaso2 >= 5,
      `${secuencia.fichasPaso2}`);

    // ── Dibujar de verdad: un arrastre tiene que dejar una forma ──
    /*
     * Esta comprobación existe por un fallo real. La primera versión colgaba el
     * `pointermove` del trazo de un `<rect>` que solo se montaba tras el `pointerdown`, y
     * con la captura del puntero ya tomada por el `<svg>` no recibía ni un evento: dibujar
     * dejaba siempre una forma de dos puntos iguales, o sea un punto. Se vio mirando una
     * captura, no en ningún test. Ahora se mide.
     */
    const dibujo = await tab.js<{ formas: number; largo: number; utilidades: number }>(`
      (async () => {
        const svg = document.querySelector('svg[role="application"]');
        const r = svg.getBoundingClientRect();
        const antes = svg.querySelectorAll("polyline, polygon, rect[fill-opacity], circle[fill-opacity]").length;

        const flecha = [...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Trazo");
        flecha.click();
        await new Promise(z => setTimeout(z, 200));

        const p = (t, x, y, target) => (target ?? svg).dispatchEvent(
          new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 7, isPrimary: true }));

        const x0 = r.x + r.width * 0.35, y0 = r.y + r.height * 0.7;
        p("pointerdown", x0, y0);
        for (let i = 1; i <= 12; i++) {
          p("pointermove", x0 + i * (r.width * 0.02), y0 - i * (r.height * 0.03), window);
          await new Promise(z => setTimeout(z, 16));
        }
        p("pointerup", x0 + r.width * 0.24, y0 - r.height * 0.36, window);
        await new Promise(z => setTimeout(z, 400));

        const poly = svg.querySelector("polyline");
        // La diagonal del rectángulo que ocupa el trazo: robusta y en unidades del mapa.
        const bb = poly ? poly.getBBox() : { width: 0, height: 0 };
        const diag = Math.hypot(bb.width, bb.height);
        return {
          formas: svg.querySelectorAll("polyline").length,
          largo: Number.isFinite(diag) ? diag : 0,
          utilidades: antes,
        };
      })()`);

    check("arrastrar con la herramienta de dibujo deja una forma", dibujo.formas >= 1, `${dibujo.formas}`);
    check("y la forma tiene recorrido: no es un punto", dibujo.largo > 40,
      `${dibujo.largo.toFixed(0)} px de mapa`);

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 6 · MÓVIL");
    // ══════════════════════════════════════════════════════════════════
    await tab.resize(390, 844, 2);
    for (const ruta of ["/entrenador", "/entrenador/mapas", "/entrenador/strats", "/entrenador/strats/revisar"]) {
      await tab.goto(`${BASE}${ruta}`, 2200);
      const m = await tab.js<{ scroll: number; client: number; mapaPrimero: boolean }>(`
        (() => {
          const d = document.documentElement;
          const svg = document.querySelector('svg[role="application"]');
          const aside = document.querySelector("aside");
          return {
            scroll: d.scrollWidth, client: d.clientWidth,
            mapaPrimero: !!svg && !!aside
              ? svg.getBoundingClientRect().top < aside.getBoundingClientRect().top
              : true,
          };
        })()`);
      check(`${ruta}: sin desbordamiento horizontal`, m.scroll <= m.client + 1, `${m.scroll} vs ${m.client}`);
      check(`${ruta}: el mapa va antes que las herramientas`, m.mapaPrimero);
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 7 · ERRORES DE CONSOLA");
    // ══════════════════════════════════════════════════════════════════
    const errores = tab.takeErrors().filter((e) => !/favicon|manifest|sw\.js/i.test(e));
    check("ninguna pantalla del Entrenador deja errores en consola", errores.length === 0,
      errores.slice(0, 2).join(" | "));
  } finally {
    await browser.close().catch(() => {});
    await admin.from("user_strats").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(
    fail === 0
      ? `\n✅ LA UI DEL ENTRENADOR AGUANTA — ${pass}/${pass + fail}`
      : `\n❌ ${fail} COMPROBACIÓN(ES) FALLARON — ${pass}/${pass + fail}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
