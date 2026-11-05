/**
 * FASE 11 · RADIOGRAFÍA DE PERFIL + PROGRESIÓN (script de auditoría, no de CI).
 *
 *   npm run build && npx next start -p 3005      (en otra terminal)
 *   E2E_BASE_URL=http://127.0.0.1:3005 SHOT_DIR=docs/product/qa/fase11 \
 *     npx tsx scripts/_fase11-audit.ts antes
 *
 * La sección de progresión del producto NO se llama como se suele suponer. Las rutas reales,
 * declaradas en `src/design/nav.ts` bajo la sección «Progreso», son:
 *
 *     /cuenta        · el PERFIL (rango, nivel y cifras)
 *     /ranking       · la CLASIFICACIÓN (global, regional y por torneo) y la escalera de rangos
 *     /logros        · LOGROS Y PASE (objetivos, misiones y pase de temporada)
 *     /recompensas   · lo que has ganado y cuándo
 *
 * No hay `/perfil`, ni `/pase`, ni `/rangos`. Este script recorre las CUATRO reales en las
 * seis resoluciones del encargo y mide, sobre la página de verdad:
 *
 *   · jerarquía (los titulares y su tamaño real)
 *   · geometría (`rounded-*`, píldoras reales, chaflanes) y primitivas del sistema
 *   · controles nativos y zonas táctiles por debajo de 44 px
 *   · desbordamiento horizontal, alto de página y profundidad de scroll
 *   · nodos DOM, animaciones en bucle y errores de consola
 *   · teclado y `prefers-reduced-motion`
 *
 * DATOS: los del producto. No se inventa ninguna cifra. Lo único que se siembra es la
 * PARTICIPACIÓN de un usuario de usar y tirar —cartas, sobres, XP, puntos de rango y una
 * predicción— a través de las RPC y servicios reales, para que el perfil no salga en blanco.
 * El usuario se borra al terminar.
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
const OUT = process.env.SHOT_DIR ?? "docs/product/qa/fase11";
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

/** Las cuatro rutas REALES de la sección Progreso. */
const RUTAS: [string, string][] = [
  ["perfil", "/cuenta"],
  ["clasificacion", "/ranking"],
  ["logros", "/logros"],
  ["recompensas", "/recompensas"],
];

/* ══════════════════ sondas que corren dentro de la página ══════════════════ */

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
    inputs: document.querySelectorAll('input:not([type=hidden])').length,
    textareas: document.querySelectorAll('textarea').length,
    // Barras de progreso: la pieza que dice «cuánto me falta».
    meters: document.querySelectorAll('[role="progressbar"]').length,
  };})()`;

const TACTIL = `(() => {
  const vis = [...document.querySelectorAll('a[href], button:not([disabled]), [role="button"], [role="tab"], [role="radio"], select, input:not([type=hidden])')]
    .filter(x => x.offsetParent !== null);
  const r = vis.map(x => {
    const q = x.getBoundingClientRect();
    return { t: (x.getAttribute('aria-label') || x.textContent || x.tagName).trim().slice(0, 30), w: Math.round(q.width), h: Math.round(q.height) };
  }).filter(x => x.h > 0);
  return {
    total: r.length,
    bajo44: r.filter(x => x.h < 44).length,
    bajo32: r.filter(x => x.h < 32).length,
    sinNombre: r.filter(x => !x.t).length,
    ejemplos: r.filter(x => x.h < 44).slice(0, 10),
  };})()`;

/**
 * JERARQUÍA. En esta fase es LA métrica: el encargo pide identidad protagonista, rango
 * secundario y estadísticas de contexto. Eso se mide en píxeles de titular.
 */
const JERARQUIA = `(() => {
  const h = [...document.querySelectorAll('h1, h2, h3')].filter(e => e.offsetParent !== null);
  return h.slice(0, 16).map(e => ({
    t: e.tagName, px: Math.round(parseFloat(getComputedStyle(e).fontSize)),
    txt: (e.textContent || '').trim().slice(0, 30),
  }));})()`;

/** Lo que dice la pantalla, resumido: para comparar con y sin movimiento. */
const RESUMEN = `(() => {
  const t = document.body.innerText.replace(/\\s+/g, ' ').trim();
  return {
    largo: t.length,
    nodos: document.querySelectorAll('*').length,
    meters: document.querySelectorAll('[role="progressbar"]').length,
    tabs: document.querySelectorAll('[role="tab"], [aria-pressed]').length,
  };})()`;

async function main(): Promise<void> {
  console.log(`# FASE 11 · RADIOGRAFÍA DE PERFIL + PROGRESIÓN (${ETIQUETA}) — ${BASE}\n`);
  mkdirSync(OUT, { recursive: true });

  const ping = await fetch(`${BASE}/cuenta`).catch(() => null);
  if (!ping?.ok) { console.error(`No hay servidor en ${BASE}.`); process.exit(1); }

  const email = `f11-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: creado, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `f11${Date.now().toString(36)}` },
  });
  if (error || !creado.user) throw new Error(error?.message ?? "no se pudo crear la cuenta");
  const userId = creado.user.id;

  const sembrado = await sembrarProgreso(userId);
  console.log(`## Progreso sembrado — ${sembrado}\n`);

  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signin } = await pub.auth.signInWithPassword({ email, password });
  const session = signin!.session!;
  const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

  const browser = await launch();
  const tab = browser.tab;
  const errores: string[] = [];

  try {
    await tab.resize(1440, 900);
    await tab.goto(`${BASE}/`, 1200);
    await tab.setStorage(storageKey, JSON.stringify(session));

    for (const [w, h, tag] of VIEWPORTS) {
      console.log(`\n## ${w}×${h}`);
      await tab.resize(w, h, 1);

      for (const [nombre, ruta] of RUTAS) {
        await tab.goto(`${BASE}${ruta}`, 3000);
        await sleep(1600);
        await tab.shot(join(OUT, `${ETIQUETA}-${tag}-${nombre}.png`));
        await shotCompleta(tab, join(OUT, `${ETIQUETA}-${tag}-${nombre}-completa.png`), w, h);

        const m = await tab.js<any>(METRICAS);
        const t = await tab.js<any>(TACTIL);
        console.log(`   ${nombre.padEnd(14)} pag ${String(m.pagina).padStart(5)} / vp ${m.vp} · scroll ×${m.scrollDepth} · overflowX ${m.overflowX}`);
        console.log(`     dom ${m.dom} · redondeados ${m.redondeados} · píldoras>24px ${m.pildorasGrandes} (de ${m.pildoras}) · chaflanes ${m.chaflanes} · bucles ${m.bucles} · meters ${m.meters}`);
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

    /* ── Estados que hay que provocar ── */
    console.log("\n## Estados provocados (1440 y 390)");
    for (const [w, h, tag] of TODAS.filter((v) => ["390", "1440"].includes(v[2]))) {
      await tab.resize(w, h, 1);

      // Las tres pestañas de la clasificación: global, regional y por torneo.
      await tab.goto(`${BASE}/ranking`, 3000);
      await sleep(1400);
      for (const etiqueta of ["Regional", "Torneo"]) {
        const ok = await tab.js<boolean>(`(async () => {
          const b = [...document.querySelectorAll('button')].find(x => new RegExp(${JSON.stringify(etiqueta)}, 'i').test(x.textContent || ''));
          if (!b) return false; b.click();
          await new Promise(r => setTimeout(r, 1200)); return true;
        })()`);
        if (ok) await tab.shot(join(OUT, `${ETIQUETA}-${tag}-clasificacion-${etiqueta.toLowerCase()}.png`));
      }

      // Sin sesión: el perfil pide cuenta. Es el estado «vacío» real del producto.
      await tab.js(`(() => { try { localStorage.removeItem(${JSON.stringify(storageKey)}); } catch {} return 1; })()`);
      await tab.goto(`${BASE}/cuenta`, 2600);
      await sleep(900);
      await tab.shot(join(OUT, `${ETIQUETA}-${tag}-perfil-sin-sesion.png`));
      await tab.goto(`${BASE}/`, 900);
      await tab.setStorage(storageKey, JSON.stringify(session));
    }

    /* ── Teclado y movimiento reducido ── */
    console.log("\n## Teclado y movimiento reducido (1440 · /cuenta)");
    await tab.resize(1440, 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await tab.goto(`${BASE}/cuenta`, 3000);
    await sleep(1600);
    const conMov = await tab.js<any>(RESUMEN);
    await tab.shot(join(OUT, `${ETIQUETA}-motion-con-movimiento.png`));

    await tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await tab.goto(`${BASE}/cuenta`, 3000);
    await sleep(1600);
    const sinMov = await tab.js<any>(RESUMEN);
    await tab.shot(join(OUT, `${ETIQUETA}-motion-reducido.png`));
    console.log(`   con movimiento: ${JSON.stringify(conMov)}`);
    console.log(`   reducido:       ${JSON.stringify(sinMov)}`);

    const teclado = await tab.js<any>(`(() => {
      const sel = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
      const foco = [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null);
      const nombre = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim();
      return {
        total: foco.length,
        sinNombre: foco.filter(e => !nombre(e)).length,
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
    await db.from("profiles").delete().eq("id", userId);
    await db.auth.admin.deleteUser(userId).catch(() => {});
  }
  console.log("\nListo.");
}

/** Captura la página COMPLETA estirando el viewport. */
async function shotCompleta(tab: Tab, file: string, w: number, h: number): Promise<void> {
  const alto = await tab.js<number>(`Math.min(document.documentElement.scrollHeight, 7000)`);
  if (alto <= h + 40) return;
  await tab.resize(w, alto, 1);
  await sleep(800);
  await tab.shot(file);
  await tab.resize(w, h, 1);
  await sleep(500);
}

/**
 * Siembra PROGRESO REAL para que el perfil no salga vacío.
 *
 * Todo por los caminos del producto: las cartas con la RPC `app_grant_cards`, y los puntos,
 * la XP y el saldo escritos en `profiles` —las columnas que solo escribe el servidor—. Aquí
 * no se calcula ningún rango ni ningún nivel: se ponen puntos y XP, y el dominio deriva de
 * ellos lo que tenga que derivar, exactamente igual que con un jugador de verdad.
 */
async function sembrarProgreso(userId: string): Promise<string> {
  // Veinte cartas del catálogo real, para que la colección y la vitrina tengan contenido.
  const cartas = CARDS.slice(0, 20).map((c) => ({ cardId: c.id, serial: null }));
  await db.rpc("app_grant_cards", {
    p_user: userId, p_instances: cartas, p_mint_delta: {}, p_origin: "admin",
  });

  /*
   * Puntos, XP y saldo. Son columnas server-only: el cliente no puede escribirlas, y por eso
   * se siembran con la clave de servicio, que es lo que hace el corrector de Pick'ems.
   * Los valores son de un jugador a media temporada; el rango y el nivel los DERIVA el
   * dominio, aquí no se decide ninguno.
   */
  const { error } = await db.from("profiles")
    .update({ points: 640, xp: 4200, credits: 12500, region: "EMEA" })
    .eq("id", userId);

  const { data: p } = await db.from("profiles")
    .select("points, xp, credits, region").eq("id", userId).maybeSingle();

  return `${cartas.length} cartas · ${JSON.stringify(p)}${error ? ` · ${error.message}` : ""}`;
}

main().catch((e: unknown) => { console.error("\n❌", e instanceof Error ? e.message : e); process.exit(1); });
