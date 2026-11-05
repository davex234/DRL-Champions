/**
 * FASE 10 · RADIOGRAFÍA DEL ENTRENADOR (script de auditoría, no de CI).
 *
 *   npm run build && npx next start -p 3005      (en otra terminal)
 *   E2E_BASE_URL=http://127.0.0.1:3005 SHOT_DIR=docs/product/qa/fase10 \
 *     npx tsx scripts/_fase10-audit.ts antes
 *
 * Recorre `/entrenador`, `/entrenador/mapas`, `/entrenador/strats` y
 * `/entrenador/strats/revisar` en las SEIS resoluciones del encargo y guarda un PNG de cada
 * estado. Además mide, sobre la página real:
 *
 *   · **cuánto viewport ocupa el mapa** — la métrica que decide si el mapa es protagonista
 *   · geometría (`rounded-*`, píldoras reales, chaflanes) y primitivas del sistema
 *   · controles nativos y zonas táctiles por debajo de 44 px
 *   · desbordamiento horizontal, alto de página y profundidad de scroll
 *   · nodos DOM, animaciones en bucle y errores de consola
 *   · teclado y `prefers-reduced-motion`
 *
 * DATOS: los del producto. No se inventa ningún mapa, jugador ni estrategia. Lo único que
 * se siembra es una ESTRATEGIA de usar y tirar, dibujada con las funciones del dominio y
 * guardada por la ruta real (`/api/game/strats`), para poder fotografiar «mapa con
 * jugadores», «con utilidades», «con líneas», «con anotaciones», «cargar» y «revisar».
 * El usuario y su estrategia se borran al terminar.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";
import {
  emptyStrat, updateStep, addUtility, addDrawing, addAnnotation, moveObject,
  DEFAULT_MAP_ID, DRAW_COLORS,
} from "@/domain/tactics";

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
const OUT = process.env.SHOT_DIR ?? "docs/product/qa/fase10";
const ETIQUETA = process.argv[2] ?? "antes";

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const TODAS: [number, number, string][] = [
  [390, 844, "390"],
  [768, 1024, "768"],
  [1024, 768, "1024"],
  [1280, 800, "1280"],
  [1440, 900, "1440"],
  [1920, 1080, "1920"],
];
const VIEWPORTS = process.env.SOLO
  ? TODAS.filter((v) => process.env.SOLO!.split(",").includes(v[2]))
  : TODAS;

/* ══════════════════ sondas que corren dentro de la página ══════════════════ */

/**
 * LA MÉTRICA QUE MANDA EN ESTA FASE: cuánto ocupa el mapa.
 *
 * El encargo dice «el mapa es el protagonista». Eso no es una opinión: es el porcentaje del
 * viewport que ocupa el lienzo táctico, y se mide.
 */
const MAPA = `(() => {
  const svg = document.querySelector('svg[role="application"]');
  if (!svg) return null;
  const b = svg.getBoundingClientRect();
  const vp = innerWidth * innerHeight;
  const im = svg.querySelector('image');
  return {
    w: Math.round(b.width), h: Math.round(b.height),
    // Porcentaje del viewport que ocupa el lienzo (recortado a lo visible).
    pctViewport: Math.round((Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(0, b.top))
      * Math.max(0, Math.min(b.right, innerWidth) - Math.max(0, b.left))) / vp * 100),
    // Y del área total de la página, que dice si compite con los paneles.
    pctPagina: Math.round((b.width * b.height) / (innerWidth * document.documentElement.scrollHeight) * 100),
    top: Math.round(b.top),
    capas: [...svg.children].filter(n => n.tagName === 'g').length,
    fichas: svg.querySelectorAll('g[role="button"]').length,
    imagen: im ? im.getAttribute('href') : null,
  };})()`;

/** Coste visual y geometría, tal y como llega al DOM. */
const METRICAS = `(() => {
  const all = [...document.querySelectorAll('*')], cs = (e) => getComputedStyle(e);
  const html = document.documentElement.outerHTML;
  const d = document.documentElement;
  const pill = all.filter(e => /9999px|50%/.test(cs(e).borderRadius));
  return {
    vp: innerHeight,
    pagina: d.scrollHeight,
    scrollDepth: +(d.scrollHeight / innerHeight).toFixed(2),
    overflowX: d.scrollWidth - d.clientWidth,
    dom: all.length,
    redondeados: all.filter(e => { const r = cs(e).borderRadius; return r && r !== '0px' && !/^0/.test(r); }).length,
    pildoras: pill.length,
    pildorasGrandes: pill.filter(e => e.getBoundingClientRect().width > 24).length,
    chaflanes: all.filter(e => cs(e).clipPath && cs(e).clipPath !== 'none').length,
    bucles: all.filter(e => cs(e).animationIterationCount === 'infinite' && cs(e).animationName !== 'none').length,
    primitivas: (() => {
      const o = {};
      for (const e of document.querySelectorAll('[data-surface]')) {
        const k = e.getAttribute('data-surface'); o[k] = (o[k] || 0) + 1;
      }
      return o;
    })(),
    clsRounded: (html.match(/rounded-(?!full)[a-z0-9\\[]/g) || []).length,
    clsRoundedFull: (html.match(/rounded-full/g) || []).length,
    clsShadow: (html.match(/shadow-[a-z]/g) || []).length,
    selects: document.querySelectorAll('select').length,
    inputs: document.querySelectorAll('input:not([type=hidden]):not([type=radio])').length,
    textareas: document.querySelectorAll('textarea').length,
  };})()`;

/**
 * Zonas táctiles. Las fichas del mapa y los controles de cámara entran aquí: en una
 * herramienta táctil son los objetivos que más se pulsan.
 */
const TACTIL = `(() => {
  const vis = [...document.querySelectorAll('a[href], button:not([disabled]), [role="button"], [role="radio"], select, input:not([type=hidden])')]
    .filter(x => x.offsetParent !== null || x.ownerSVGElement);
  const r = vis.map(x => {
    const q = x.getBoundingClientRect();
    return {
      t: (x.getAttribute('aria-label') || x.textContent || x.tagName).trim().slice(0, 28),
      w: Math.round(q.width), h: Math.round(q.height),
      svg: !!x.ownerSVGElement,
    };
  }).filter(x => x.h > 0);
  return {
    total: r.length,
    bajo44: r.filter(x => x.h < 44 && !x.svg).length,
    bajo32: r.filter(x => x.h < 32 && !x.svg).length,
    sinNombre: r.filter(x => !x.t).length,
    ejemplos: r.filter(x => x.h < 44 && !x.svg).slice(0, 10),
  };})()`;

/** Los titulares, en orden, con su tamaño real. */
const JERARQUIA = `(() => {
  const h = [...document.querySelectorAll('h1, h2, h3')].filter(e => e.offsetParent !== null);
  return h.slice(0, 14).map(e => ({
    t: e.tagName, px: Math.round(parseFloat(getComputedStyle(e).fontSize)),
    txt: (e.textContent || '').trim().slice(0, 34),
  }));})()`;

/** Lo que dice la pantalla, resumido: para comparar con y sin movimiento. */
const RESUMEN = `(() => {
  const t = document.body.innerText.replace(/\\s+/g, ' ').trim();
  const svg = document.querySelector('svg[role="application"]');
  return {
    largo: t.length,
    nodos: document.querySelectorAll('*').length,
    fichas: svg ? svg.querySelectorAll('g[role="button"]').length : 0,
    capas: svg ? [...svg.children].filter(n => n.tagName === 'g').length : 0,
  };})()`;

async function main(): Promise<void> {
  console.log(`# FASE 10 · RADIOGRAFÍA DEL ENTRENADOR (${ETIQUETA}) — ${BASE}\n`);
  mkdirSync(OUT, { recursive: true });

  const ping = await fetch(`${BASE}/entrenador`).catch(() => null);
  if (!ping?.ok) { console.error(`No hay servidor en ${BASE}.`); process.exit(1); }

  /* ── Usuario de usar y tirar, con una estrategia dibujada de verdad ── */
  const email = `f10-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: creado, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `f10${Date.now().toString(36)}` },
  });
  if (error || !creado.user) throw new Error(error?.message ?? "no se pudo crear la cuenta");
  const userId = creado.user.id;

  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signin } = await pub.auth.signInWithPassword({ email, password });
  const session = signin!.session!;
  const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

  const sembradas = await sembrarEstrategia(session.access_token);
  console.log(`## Estrategia sembrada: ${sembradas}\n`);

  const browser = await launch();
  const tab = browser.tab;
  const errores: string[] = [];

  try {
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}/`, 1200);
    await tab.setStorage(storageKey, JSON.stringify(session));

    const rutas: [string, string][] = [
      ["hub", "/entrenador"],
      ["mapas", "/entrenador/mapas"],
      ["pizarra", "/entrenador/strats"],
      ["revisar", "/entrenador/strats/revisar"],
    ];

    for (const [w, h, tag] of VIEWPORTS) {
      console.log(`\n## ${w}×${h}`);
      await tab.resize(w, h, 1);

      for (const [nombre, ruta] of rutas) {
        await tab.goto(`${BASE}${ruta}`, 3000);
        await sleep(nombre === "hub" ? 900 : 1600);
        await tab.shot(join(OUT, `${ETIQUETA}-${tag}-${nombre}.png`));
        await shotCompleta(tab, join(OUT, `${ETIQUETA}-${tag}-${nombre}-completa.png`), w, h);

        const m = await tab.js<any>(METRICAS);
        const mapa = await tab.js<any>(MAPA);
        const t = await tab.js<any>(TACTIL);
        console.log(`   ${nombre.padEnd(9)} pag ${String(m.pagina).padStart(5)} / vp ${m.vp} · scroll ×${m.scrollDepth} · overflowX ${m.overflowX}`);
        console.log(`     MAPA ${mapa ? `${mapa.w}×${mapa.h} · ${mapa.pctViewport} % del viewport · ${mapa.pctPagina} % de la página · top ${mapa.top} · ${mapa.capas} capas · ${mapa.fichas} fichas` : "— (no hay lienzo)"}`);
        console.log(`     dom ${m.dom} · redondeados ${m.redondeados} · píldoras>24px ${m.pildorasGrandes} (de ${m.pildoras}) · chaflanes ${m.chaflanes} · bucles ${m.bucles}`);
        console.log(`     clases: rounded ${m.clsRounded} · rounded-full ${m.clsRoundedFull} · shadow ${m.clsShadow}`);
        console.log(`     primitivas ${JSON.stringify(m.primitivas)} · select ${m.selects} · input ${m.inputs} · textarea ${m.textareas}`);
        console.log(`     táctil: ${t.total} controles · ${t.bajo44} <44px · ${t.bajo32} <32px · ${t.sinNombre} sin nombre`);
        if (t.bajo44 > 0 && (tag === "390" || tag === "1440")) {
          for (const e of t.ejemplos) console.log(`       · "${e.t}" ${e.w}×${e.h}`);
        }
        if (tag === "1440") {
          const j = await tab.js<any[]>(JERARQUIA);
          console.log(`     jerarquía: ${j.map((x) => `${x.t}/${x.px}px "${x.txt}"`).join(" | ")}`);
        }
        errores.push(...tab.takeErrors());
      }
    }

    /* ── Estados de la pizarra que hay que provocar ── */
    console.log("\n## Estados de la pizarra (1440 y 390)");
    for (const [w, h, tag] of TODAS.filter((v) => ["390", "1440"].includes(v[2]))) {
      await tab.resize(w, h, 1);
      await tab.goto(`${BASE}/entrenador/strats`, 3200);
      await sleep(1200);

      // Mapa recién abierto: los cinco puestos, nada dibujado.
      await tab.shot(join(OUT, `${ETIQUETA}-${tag}-pizarra-vacia.png`));

      // Abrir la estrategia sembrada: jugadores + utilidades + líneas + anotaciones.
      const abierta = await tab.js<boolean>(`(async () => {
        const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Abrir');
        if (!b) return false;
        b.click();
        await new Promise(r => setTimeout(r, 1400));
        return true;
      })()`);
      await tab.shot(join(OUT, `${ETIQUETA}-${tag}-pizarra-completa-estado.png`));
      const lleno = await tab.js<any>(MAPA);
      console.log(`   ${tag} · estrategia abierta: ${abierta} · fichas ${lleno?.fichas ?? 0} · mapa ${lleno?.pctViewport ?? 0} % del viewport`);

      // Herramienta seleccionada (utilidad): el rail en estado activo.
      await tab.js(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '') === 'Humo');
        if (b) b.click();
        return !!b;
      })()`);
      await sleep(400);
      await tab.shot(join(OUT, `${ETIQUETA}-${tag}-herramienta-activa.png`));
      await shotCompleta(tab, join(OUT, `${ETIQUETA}-${tag}-pizarra-completa.png`), w, h);
    }

    /* ── Teclado y movimiento reducido ── */
    console.log("\n## Teclado y movimiento reducido (1440)");
    await tab.resize(1440, 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await tab.goto(`${BASE}/entrenador/strats`, 3200);
    await sleep(1500);
    const conMov = await tab.js<any>(RESUMEN);
    await tab.shot(join(OUT, `${ETIQUETA}-motion-con-movimiento.png`));

    await tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await tab.goto(`${BASE}/entrenador/strats`, 3200);
    await sleep(1500);
    const sinMov = await tab.js<any>(RESUMEN);
    await tab.shot(join(OUT, `${ETIQUETA}-motion-reducido.png`));
    console.log(`   con movimiento: ${JSON.stringify(conMov)}`);
    console.log(`   reducido:       ${JSON.stringify(sinMov)}`);

    const teclado = await tab.js<any>(`(() => {
      const sel = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
      const foco = [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null || e.ownerSVGElement);
      const nombre = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim();
      return {
        total: foco.length,
        sinNombre: foco.filter(e => !nombre(e)).length,
        fichasEnfocables: [...document.querySelectorAll('svg g[role="button"][tabindex]')].length,
        conFocoVisible: foco.filter(e => {
          const cs = getComputedStyle(e, ':focus-visible');
          return cs.outlineStyle !== 'none' || /ring|nx-focus/.test(String(e.className.baseVal ?? e.className));
        }).length,
      };})()`);
    console.log(`   teclado: ${JSON.stringify(teclado)}`);

    console.log(`\n## Errores de consola: ${errores.length}`);
    for (const e of [...new Set(errores)].slice(0, 10)) console.log(`   · ${e.slice(0, 150)}`);
  } finally {
    await browser.close().catch(() => {});
    await db.from("user_strats").delete().eq("user_id", userId);
    await db.from("profiles").delete().eq("id", userId);
    await db.auth.admin.deleteUser(userId).catch(() => {});
  }
  console.log("\nListo.");
}

/**
 * Captura la página COMPLETA estirando el viewport.
 *
 * En el Entrenador importa más que en ninguna otra pantalla: el lienzo mide `vh`, así que
 * estirar el viewport cambia lo que se ve. Se avisa en el nombre del fichero.
 */
async function shotCompleta(tab: Tab, file: string, w: number, h: number): Promise<void> {
  const alto = await tab.js<number>(`Math.min(document.documentElement.scrollHeight, 6000)`);
  if (alto <= h + 40) return;
  await tab.resize(w, alto, 1);
  await sleep(800);
  await tab.shot(file);
  await tab.resize(w, h, 1);
  await sleep(500);
}

/**
 * Siembra UNA estrategia con contenido real de los cuatro tipos.
 *
 * Se construye con las funciones del DOMINIO —`emptyStrat`, `addUtility`, `addDrawing`,
 * `addAnnotation`, `moveObject`— y se guarda por la RUTA real, que la vuelve a sanear con
 * `sanitizeStrat`. Aquí no se escribe JSON a mano en la base: si el servidor la rechazara,
 * la auditoría se enteraría.
 */
async function sembrarEstrategia(token: string): Promise<string> {
  let s = emptyStrat("nueva", DEFAULT_MAP_ID, "attack", "Ejecución A rápida");
  s = { ...s, description: "Humo doble en A Main, entrada por rampa y plante corto.", tags: ["default", "rápida"] };

  /*
   * Todo con las funciones del dominio, envueltas en `updateStep` — que es exactamente lo
   * que hace el editor. Los cinco jugadores ya nacen colocados: se MUEVEN, no se añaden.
   */
  const puestos: [number, number][] = [[30, 62], [38, 58], [46, 60], [55, 66], [62, 70]];
  s.steps[0].state.players.forEach((p, i) => {
    const [x, y] = puestos[i] ?? [40 + i * 6, 64];
    s = updateStep(s, 0, (st) => moveObject(st, p.id, x, y));
  });

  s = updateStep(s, 0, (st) => addUtility(st, "smoke", 34, 44));
  s = updateStep(s, 0, (st) => addUtility(st, "smoke", 44, 42));
  s = updateStep(s, 0, (st) => addUtility(st, "flash", 52, 48));
  s = updateStep(s, 0, (st) => addUtility(st, "molly", 40, 38));

  s = updateStep(s, 0, (st) => addDrawing(st, "arrow", DRAW_COLORS[0], [{ x: 32, y: 62 }, { x: 38, y: 48 }, { x: 42, y: 40 }]));
  s = updateStep(s, 0, (st) => addDrawing(st, "arrow", DRAW_COLORS[1], [{ x: 60, y: 68 }, { x: 56, y: 52 }]));
  s = updateStep(s, 0, (st) => addDrawing(st, "zone", DRAW_COLORS[2], [{ x: 36, y: 34 }, { x: 50, y: 34 }, { x: 50, y: 44 }, { x: 36, y: 44 }]));

  s = updateStep(s, 0, (st) => addAnnotation(st, "Humo doble antes de entrar", 30, 30));
  s = updateStep(s, 0, (st) => addAnnotation(st, "Plante corto", 52, 36));

  const res = await fetch(`${BASE}/api/game/strats`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "save", id: null, strat: s }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok) throw new Error(`el servidor rechazó la estrategia: ${json.error ?? res.status}`);
  return `${s.name} (${res.status}) · ${s.steps[0].state.utilities.length} utilidades · ${s.steps[0].state.drawings.length} dibujos · ${s.steps[0].state.annotations.length} notas`;
}

main().catch((e: unknown) => { console.error("\n❌", e instanceof Error ? e.message : e); process.exit(1); });
