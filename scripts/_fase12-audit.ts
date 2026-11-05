/**
 * FASE 12 · RADIOGRAFÍA GLOBAL DE NEXUS (script de auditoría, no de CI).
 *
 *   npm run build && npx next start -p 3005      (en otra terminal)
 *   E2E_BASE_URL=http://127.0.0.1:3005 SHOT_DIR=docs/product/qa/fase12 \
 *     npx tsx scripts/_fase12-audit.ts antes
 *
 * Las fases 4-11 trabajaron pantalla por pantalla. Esta mira el producto ENTERO y busca lo
 * que sobrevive a una pasada vertical: que dos pantallas resuelvan lo mismo de dos maneras.
 *
 * Recorre las once zonas del producto MÁS el recorrido real de un jugador —Home → Colección →
 * Tienda → Mercado → Duelos → Torneos → Pick'ems → Entrenador → Progreso— y mide en cada una:
 *
 *   · primitivas de superficie y chaflanes  → ¿hablan el mismo idioma?
 *   · geometría redondeada y cápsulas       → ¿queda lenguaje prestado?
 *   · controles nativos                     → `<select>`, `<input>` sin vestir
 *   · zonas táctiles y nombres accesibles   → el mínimo del producto
 *   · barras de progreso con semántica      → `role="progressbar"`
 *   · estados (Loading / Empty / Error)     → ¿comparten pieza?
 *   · animaciones en bucle y errores de consola
 *   · desbordamiento horizontal y profundidad de scroll
 *   · jerarquía: el H1 de cada pantalla y su tamaño real
 *
 * Y compara la navegación: qué enlaces del armazón hay en cada zona y cuál está activo.
 *
 * DATOS: los del producto. Se siembra un usuario de usar y tirar con cartas, sobres, créditos,
 * XP y puntos —por las RPC y columnas reales— para que ninguna pantalla salga vacía por falta
 * de cuenta. Se borra al terminar.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";
import { CARDS } from "@/data/catalog";

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
const OUT = process.env.SHOT_DIR ?? "docs/product/qa/fase12";
const ETIQUETA = process.argv[2] ?? "antes";

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

/**
 * Las ONCE zonas del producto, en el orden del recorrido real de un jugador.
 * `/duelos/jugar` va aparte porque es inmersiva (sin armazón) y falsearía la comparación.
 */
const ZONAS: [string, string][] = [
  ["01-home", "/"],
  ["02-coleccion", "/coleccion"],
  ["03-colecciones", "/colecciones"],
  ["04-inventario", "/inventario"],
  ["05-tienda", "/tienda"],
  ["06-mercado", "/mercado"],
  ["07-duelos", "/duelos"],
  ["08-duelos-mazos", "/duelos/mazos"],
  ["09-torneos", "/torneos"],
  ["10-pickems", "/pickems"],
  ["11-entrenador", "/entrenador"],
  ["12-entrenador-strats", "/entrenador/strats"],
  ["13-cuenta", "/cuenta"],
  ["14-logros", "/logros"],
  ["15-ranking", "/ranking"],
  ["16-recompensas", "/recompensas"],
  ["17-eventos", "/eventos"],
];

/** Las dos resoluciones obligatorias; las demás solo si un problema es responsive. */
const TODAS: [number, number, string][] = [
  [390, 844, "390"],
  [768, 1024, "768"],
  [1024, 768, "1024"],
  [1280, 800, "1280"],
  [1440, 900, "1440"],
  [1920, 1080, "1920"],
];
const VIEWPORTS = TODAS.filter((v) =>
  (process.env.SOLO ?? "390,1440").split(",").includes(v[2]));

/* ══════════════════ la sonda: una pantalla, todo lo que importa ══════════════════ */

const RADIO = `(() => {
  const all = [...document.querySelectorAll('*')], cs = (e) => getComputedStyle(e);
  const d = document.documentElement;
  const html = d.outerHTML;
  const pill = all.filter(e => /9999px|50%/.test(cs(e).borderRadius));
  const vis = (e) => e.offsetParent !== null || e.ownerSVGElement;

  // ── Controles: tamaño, nombre y foco ──
  const ctrls = [...document.querySelectorAll('a[href], button:not([disabled]), [role="button"], [role="tab"], [role="radio"], select, input:not([type=hidden]), textarea')]
    .filter(vis)
    .map(x => {
      const q = x.getBoundingClientRect();
      return {
        t: (x.getAttribute('aria-label') || x.textContent || x.tagName).trim().slice(0, 30),
        w: Math.round(q.width), h: Math.round(q.height),
        /*
         * El armazón compartido no es de la pantalla. Se reconoce por sus landmarks: el
         * armazón pinta su cabecera en un header y sus dos navegaciones en nav, y el
         * contenido de cada ruta vive dentro de main. Lo que no está en main es del
         * armazón, y se descuenta para no cargarle a una pantalla los controles que
         * comparte con las otras once.
         */
        shell: !x.closest('main'),
      };
    }).filter(x => x.h > 0);

  const h1 = document.querySelector('h1');
  return {
    // ── Reparto ──
    vp: innerHeight,
    pagina: d.scrollHeight,
    scrollDepth: +(d.scrollHeight / innerHeight).toFixed(2),
    overflowX: d.scrollWidth - d.clientWidth,
    dom: all.length,

    // ── Idioma visual ──
    primitivas: (() => {
      const o = {};
      for (const e of document.querySelectorAll('[data-surface]')) {
        const k = e.getAttribute('data-surface'); o[k] = (o[k] || 0) + 1;
      }
      return o;
    })(),
    chaflanes: all.filter(e => cs(e).clipPath && cs(e).clipPath !== 'none').length,
    redondeados: all.filter(e => { const r = cs(e).borderRadius; return r && r !== '0px' && !/^0/.test(r); }).length,
    // Cápsula DE VERDAD: redonda y ancha. Un punto de estado de 6 px no cuenta.
    capsulas: pill.filter(e => e.getBoundingClientRect().width > 24 && e.getBoundingClientRect().height > 16).length,
    clsRounded: (html.match(/rounded-(?!full)[a-z0-9\\[]/g) || []).length,
    clsRoundedFull: (html.match(/rounded-full/g) || []).length,
    clsShadow: (html.match(/shadow-[a-z]/g) || []).length,

    // ── Controles nativos sin vestir ──
    selects: document.querySelectorAll('select').length,
    inputsTexto: document.querySelectorAll('input[type=text], input[type=search], input:not([type])').length,

    // ── Accesibilidad ──
    ctrlTotal: ctrls.length,
    bajo44: ctrls.filter(x => x.h < 44).length,
    bajo44Propios: ctrls.filter(x => x.h < 44 && !x.shell).length,
    sinNombre: ctrls.filter(x => !x.t).length,
    ejemplos: ctrls.filter(x => x.h < 44 && !x.shell).slice(0, 8),
    meters: document.querySelectorAll('[role="progressbar"]').length,
    dialogos: document.querySelectorAll('[role="dialog"]').length,

    // ── Jerarquía ──
    h1: h1 ? { px: Math.round(parseFloat(cs(h1).fontSize)), txt: (h1.textContent || '').trim().slice(0, 28) } : null,
    h2px: [...new Set([...document.querySelectorAll('h2')].filter(vis).map(e => Math.round(parseFloat(cs(e).fontSize))))].sort((a,b)=>b-a),

    // ── Movimiento ──
    bucles: all.filter(e => cs(e).animationIterationCount === 'infinite' && cs(e).animationName !== 'none').length,

    // ── Idioma (copy): palabras en inglés sueltas en la interfaz visible ──
    ingles: (() => {
      const t = document.body.innerText;
      const sospechosas = ['Loading', 'Error:', 'Submit', 'Cancel', 'Close', 'Search', 'Filter', 'Sort by', 'Settings', 'Profile', 'Rewards', 'Achievements'];
      return sospechosas.filter(w => t.includes(w));
    })(),
  };})()`;

/** Qué ofrece la navegación del armazón y qué está marcado como activo. */
const NAV = `(() => {
  const shell = document.querySelector('header') || document.body;
  const links = [...shell.querySelectorAll('a[href]')].filter(a => a.offsetParent !== null);
  const activos = links.filter(a => a.getAttribute('aria-current') || /border-drl|text-drl\\b/.test(a.className || ''));
  return {
    enlaces: links.length,
    activo: activos.map(a => (a.textContent || '').trim().slice(0, 20))[0] ?? null,
    conAriaCurrent: links.filter(a => a.getAttribute('aria-current')).length,
  };})()`;

/** Lo que dice la pantalla: para comparar con y sin movimiento. */
const RESUMEN = `(() => {
  const t = document.body.innerText.replace(/\\s+/g, ' ').trim();
  return {
    largo: t.length,
    nodos: document.querySelectorAll('*').length,
    controles: document.querySelectorAll('a[href], button:not([disabled])').length,
    meters: document.querySelectorAll('[role="progressbar"]').length,
  };})()`;

async function main(): Promise<void> {
  console.log(`# FASE 12 · RADIOGRAFÍA GLOBAL (${ETIQUETA}) — ${BASE}\n`);
  mkdirSync(OUT, { recursive: true });

  const ping = await fetch(`${BASE}/`).catch(() => null);
  if (!ping?.ok) { console.error(`No hay servidor en ${BASE}.`); process.exit(1); }

  const email = `f12-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: creado, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `f12${Date.now().toString(36)}` },
  });
  if (error || !creado.user) throw new Error(error?.message ?? "no se pudo crear la cuenta");
  const userId = creado.user.id;
  console.log(`## Usuario sembrado — ${await sembrar(userId)}\n`);

  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signin } = await pub.auth.signInWithPassword({ email, password });
  const session = signin!.session!;
  const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

  const browser = await launch();
  const tab = browser.tab;
  const errores: string[] = [];
  const filas: any[] = [];

  try {
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}/`, 1200);
    await tab.setStorage(storageKey, JSON.stringify(session));

    for (const [w, h, tag] of VIEWPORTS) {
      console.log(`\n${"═".repeat(78)}\n## ${w}×${h}\n${"═".repeat(78)}`);
      await tab.resize(w, h, 1);

      for (const [nombre, ruta] of ZONAS) {
        await tab.goto(`${BASE}${ruta}`, 2800);
        await sleep(1400);
        await tab.shot(join(OUT, `${ETIQUETA}-${tag}-${nombre}.png`));

        const r = await tab.js<any>(RADIO);
        const nav = await tab.js<any>(NAV);
        const errs = tab.takeErrors();
        errores.push(...errs.map((e) => `${ruta} · ${e}`));
        filas.push({ tag, nombre, ruta, ...r, nav, errs: errs.length });

        console.log(`\n   ── ${nombre.padEnd(22)} ${ruta}`);
        console.log(`      pag ${String(r.pagina).padStart(5)} · scroll ×${r.scrollDepth} · overflowX ${r.overflowX} · dom ${r.dom}`);
        console.log(`      primitivas ${JSON.stringify(r.primitivas)} · chaflanes ${r.chaflanes}`);
        console.log(`      redondeados ${r.redondeados} · CÁPSULAS ${r.capsulas} · clsRounded ${r.clsRounded} · clsFull ${r.clsRoundedFull}`);
        console.log(`      nativos: select ${r.selects} · input texto ${r.inputsTexto}`);
        console.log(`      táctil ${r.ctrlTotal} ctrl · ${r.bajo44Propios} PROPIOS <44px (${r.bajo44} con armazón) · ${r.sinNombre} sin nombre`);
        console.log(`      meters ${r.meters} · bucles ${r.bucles} · errores ${errs.length}`);
        console.log(`      H1 ${r.h1 ? `${r.h1.px}px "${r.h1.txt}"` : "—"} · H2 ${JSON.stringify(r.h2px)}`);
        console.log(`      nav ${nav.enlaces} enlaces · activo "${nav.activo}" · aria-current ${nav.conAriaCurrent}`);
        if (r.ingles.length) console.log(`      ⚠ inglés visible: ${JSON.stringify(r.ingles)}`);
        for (const e of r.ejemplos) console.log(`        · "${e.t}" ${e.w}×${e.h}`);
      }
    }

    /* ── RESUMEN TRANSVERSAL ── */
    console.log(`\n${"═".repeat(78)}\n## MATRIZ GLOBAL\n${"═".repeat(78)}`);
    for (const tag of VIEWPORTS.map((v) => v[2])) {
      const de = filas.filter((f) => f.tag === tag);
      console.log(`\n### ${tag}`);
      console.log("    zona                   prim chaf caps rnd sel <44 sinN met bucl err  H1");
      for (const f of de) {
        const prim = Object.values(f.primitivas as Record<string, number>).reduce((a, b) => a + b, 0);
        console.log(
          `    ${f.nombre.padEnd(22)} ${String(prim).padStart(4)} ${String(f.chaflanes).padStart(4)} ` +
          `${String(f.capsulas).padStart(4)} ${String(f.clsRounded).padStart(3)} ${String(f.selects).padStart(3)} ` +
          `${String(f.bajo44Propios).padStart(3)} ${String(f.sinNombre).padStart(4)} ${String(f.meters).padStart(3)} ` +
          `${String(f.bucles).padStart(4)} ${String(f.errs).padStart(3)}  ${f.h1 ? f.h1.px + "px" : "—"}`,
        );
      }
      const tot = (k: string) => de.reduce((a: number, f: any) => a + (f[k] ?? 0), 0);
      console.log(`    ${"TOTAL".padEnd(22)} ${" ".repeat(4)} ${" ".repeat(4)} ${String(tot("capsulas")).padStart(4)} ` +
        `${String(tot("clsRounded")).padStart(3)} ${String(tot("selects")).padStart(3)} ${String(tot("bajo44Propios")).padStart(3)} ` +
        `${String(tot("sinNombre")).padStart(4)} ${String(tot("meters")).padStart(3)} ${String(tot("bucles")).padStart(4)} ${String(tot("errs")).padStart(3)}`);
    }

    /* ── MOVIMIENTO REDUCIDO, EN TODO EL PRODUCTO ── */
    console.log(`\n${"═".repeat(78)}\n## MOVIMIENTO REDUCIDO (1440, todas las zonas)\n${"═".repeat(78)}`);
    await tab.resize(1440, 900, 1);
    const conMov: Record<string, any> = {};
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    for (const [nombre, ruta] of ZONAS) {
      await tab.goto(`${BASE}${ruta}`, 2400); await sleep(1100);
      conMov[nombre] = await tab.js<any>(RESUMEN);
    }
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    console.log("    zona                    texto(con/sin)   controles   meters   veredicto");
    for (const [nombre, ruta] of ZONAS) {
      await tab.goto(`${BASE}${ruta}`, 2400); await sleep(1100);
      const s = await tab.js<any>(RESUMEN);
      const c = conMov[nombre];
      const ok = s.largo === c.largo && s.controles === c.controles && s.meters === c.meters;
      console.log(`    ${nombre.padEnd(22)} ${String(c.largo).padStart(6)}/${String(s.largo).padEnd(6)} ` +
        `${String(c.controles).padStart(4)}/${String(s.controles).padEnd(4)} ` +
        `${String(c.meters).padStart(3)}/${String(s.meters).padEnd(3)} ` +
        `${ok ? "PASS" : `WARN · nodos ${c.nodos}→${s.nodos}`}`);
    }
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);

    console.log(`\n## Errores de consola: ${errores.length}`);
    for (const e of [...new Set(errores)].slice(0, 14)) console.log(`   · ${e.slice(0, 160)}`);
  } finally {
    await browser.close().catch(() => {});
    await db.from("profiles").delete().eq("id", userId);
    await db.auth.admin.deleteUser(userId).catch(() => {});
  }
  console.log("\nListo.");
}

/** Un jugador a media temporada, por los caminos reales del producto. */
async function sembrar(userId: string): Promise<string> {
  await db.rpc("app_grant_cards", {
    p_user: userId,
    p_instances: CARDS.slice(0, 40).map((c) => ({ cardId: c.id, serial: null })),
    p_mint_delta: {}, p_origin: "admin",
  });
  await db.from("profiles")
    .update({ points: 640, xp: 4200, credits: 18000, region: "EMEA" })
    .eq("id", userId);
  const { data: p } = await db.from("profiles")
    .select("points, xp, credits, region").eq("id", userId).maybeSingle();
  return `40 cartas · ${JSON.stringify(p)}`;
}

main().catch((e: unknown) => { console.error("\n❌", e instanceof Error ? e.message : e); process.exit(1); });
