/**
 * FASE 9 · RADIOGRAFÍA DE TORNEOS + PICK'EMS (script de auditoría, no de CI).
 *
 *   npm run build && npx next start -p 3005      (en otra terminal)
 *   E2E_BASE_URL=http://127.0.0.1:3005 SHOT_DIR=docs/product/qa/fase9 \
 *     npx tsx scripts/_fase9-audit.ts antes
 *
 * Recorre `/torneos`, `/torneos/[id]` y `/pickems` en las SEIS resoluciones del encargo y
 * guarda un PNG de cada estado. Además mide, en el navegador y sobre la página real:
 *
 *   · alto de página, desbordamiento horizontal y profundidad de scroll
 *   · geometría (`rounded-*`, `rounded-full`, sombras, `text-[Npx]`) tal y como llega al DOM
 *   · primitivas del sistema presentes (`[data-surface]`)
 *   · controles nativos (`<select>`, `<input>`) y zonas táctiles por debajo de 44 px
 *   · errores de consola
 *   · teclado y `prefers-reduced-motion`
 *
 * DATOS: los del producto. No se inventa ningún torneo, partido, equipo ni resultado. Lo
 * único que se siembra es la PARTICIPACIÓN de un usuario de usar y tirar —sus predicciones—
 * a través de `submitPick`, el mismo servicio del producto, para poder fotografiar los
 * estados «pendiente», «elegida», «acertada» y «fallada». El usuario se borra al terminar.
 *
 * ANSWER=correcta|fallada elige qué predicción se siembra en la pregunta ya corregida.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { launch, sleep, type Tab } from "./lib/cdp";
import { submitPick, scorePickemEvent } from "@/server/services/pickems";

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
const OUT = process.env.SHOT_DIR ?? "docs/product/qa/fase9";
const ETIQUETA = process.argv[2] ?? "antes";
const ANSWER = process.env.ANSWER ?? "correcta";

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

/** Las seis resoluciones del encargo, de la más apretada a la más holgada. */
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

/** Coste visual y geometría, tal y como llega al DOM (no al código fuente). */
const METRICAS = `(() => {
  const all = [...document.querySelectorAll('*')], cs = (e) => getComputedStyle(e);
  const html = document.documentElement.outerHTML;
  const d = document.documentElement;
  const redondos = all.filter(e => {
    const r = cs(e).borderRadius;
    return r && r !== '0px' && !/^0/.test(r);
  });
  const pill = all.filter(e => /9999px|50%/.test(cs(e).borderRadius));
  return {
    vp: innerHeight,
    pagina: d.scrollHeight,
    scrollDepth: +(d.scrollHeight / innerHeight).toFixed(2),
    overflowX: d.scrollWidth - d.clientWidth,
    dom: all.length,
    // Geometría redondeada REAL (computada), no la clase escrita.
    redondeados: redondos.length,
    pildoras: pill.length,
    /*
     * PÍLDORAS DE VERDAD. Contar el radio 9999px a secas miente: un punto de estado de 6 px
     * y una insignia circular TIENEN que ser redondos, y el sistema los usa. Lo que la fase
     * persigue es la píldora como CONTENEDOR —el botón y la tarjeta con forma de cápsula—,
     * así que se cuentan aparte las que miden más de 24 px de ancho.
     */
    pildorasGrandes: pill.filter(e => e.getBoundingClientRect().width > 24).length,
    /*
     * SOMBRAS QUE PROYECTAN. El sistema construye sus cantos con inset, así que contar toda
     * box-shadow distinta de none sube al aplicar las primitivas aunque no haya ni una
     * sombra flotante más. Estas son las que de verdad despegan algo del plano.
     */
    sombrasProyectadas: all.filter(e => {
      const b = cs(e).boxShadow;
      return b !== 'none' && b.split(',').some(p => !p.includes('inset'));
    }).length,
    /*
     * DISCIPLINA TIPOGRÁFICA. La métrica que importa no es cuántas veces aparece la clase
     * text-[Npx] —las primitivas la usan por dentro— sino CUÁNTOS TAMAÑOS DISTINTOS acaba
     * habiendo en pantalla. Catorce tamaños en una pantalla es el problema; ocho no.
     */
    tamanosDeLetra: [...new Set(all
      .filter(e => e.offsetParent !== null && (e.textContent || '').trim().length > 0)
      .map(e => cs(e).fontSize))].length,
    // Chaflán de la casa: los clip-path del sistema.
    chaflanes: all.filter(e => cs(e).clipPath && cs(e).clipPath !== 'none').length,
    sombras: all.filter(e => cs(e).boxShadow !== 'none').length,
    animaciones: all.filter(e => cs(e).animationName !== 'none').length,
    bucles: all.filter(e => cs(e).animationIterationCount === 'infinite' && cs(e).animationName !== 'none').length,
    mixBlend: all.filter(e => cs(e).mixBlendMode !== 'normal').length,
    // Primitivas del sistema presentes.
    primitivas: (() => {
      const o = {};
      for (const e of document.querySelectorAll('[data-surface]')) {
        const k = e.getAttribute('data-surface'); o[k] = (o[k] || 0) + 1;
      }
      return o;
    })(),
    // Clases de la hoja de estilo, contadas sobre el marcado servido.
    clsRounded: (html.match(/rounded-(?!full)[a-z0-9\\[]/g) || []).length,
    clsRoundedFull: (html.match(/rounded-full/g) || []).length,
    clsTextPx: (html.match(/text-\\[\\d+px\\]/g) || []).length,
    clsShadow: (html.match(/shadow-[a-z]/g) || []).length,
    // Controles nativos sin vestir.
    selects: document.querySelectorAll('select').length,
    inputs: document.querySelectorAll('input:not([type=hidden])').length,
    botones: document.querySelectorAll('button').length,
    enlaces: document.querySelectorAll('a[href]').length,
  };})()`;

/** Zonas táctiles y nombres accesibles de todo lo interactivo visible. */
const TACTIL = `(() => {
  const vis = [...document.querySelectorAll('a[href], button:not([disabled]), [role="button"]')]
    .filter(x => x.offsetParent !== null);
  const r = vis.map(x => {
    const q = x.getBoundingClientRect();
    return { t: (x.getAttribute('aria-label') || x.textContent || '').trim().slice(0, 30), w: Math.round(q.width), h: Math.round(q.height) };
  }).filter(x => x.h > 0);
  return {
    total: r.length,
    bajo44: r.filter(x => x.h < 44).length,
    bajo32: r.filter(x => x.h < 32).length,
    sinNombre: r.filter(x => !x.t).length,
    ejemplos: r.filter(x => x.h < 44).slice(0, 8),
  };})()`;

/** Jerarquía: los titulares de la página, en orden, con su tamaño real. */
const JERARQUIA = `(() => {
  const h = [...document.querySelectorAll('h1, h2, h3')].filter(e => e.offsetParent !== null);
  return h.slice(0, 14).map(e => ({
    t: e.tagName,
    px: Math.round(parseFloat(getComputedStyle(e).fontSize)),
    txt: (e.textContent || '').trim().slice(0, 40),
  }));})()`;

async function main(): Promise<void> {
  console.log(`# FASE 9 · RADIOGRAFÍA (${ETIQUETA}) — ${BASE}\n`);
  mkdirSync(OUT, { recursive: true });

  const ping = await fetch(`${BASE}/torneos`).catch(() => null);
  if (!ping?.ok) { console.error(`No hay servidor en ${BASE}.`); process.exit(1); }

  /* ── Qué hay en el circuito, según el producto ── */
  const { data: eventos } = await db.from("events")
    .select("id, name, status, source").order("status");
  const { data: pes } = await db.from("pickem_events").select("id, title, event_id, status");
  const activo = (eventos ?? []).find((e) => e.status === "ongoing") ?? (eventos ?? [])[0];
  const pickem = (pes ?? []).find((p) => p.event_id === activo?.id) ?? (pes ?? [])[0];
  console.log("## Circuito en la base de datos");
  for (const e of eventos ?? []) console.log(`   · ${e.status.padEnd(9)} ${e.source.padEnd(5)} ${e.name}`);
  console.log(`   destacado esperado: ${activo?.name} · pick'em: ${pickem?.id ?? "ninguno"}\n`);

  /* ── Usuario de usar y tirar, con participación real ── */
  const email = `f9-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: creado, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `f9${Date.now().toString(36)}` },
  });
  if (error || !creado.user) throw new Error(error?.message ?? "no se pudo crear la cuenta");
  const userId = creado.user.id;

  let sembrado = { abiertas: 0, resuelta: "" };
  if (pickem) sembrado = await sembrarParticipacion(db, userId, pickem.id);
  console.log(`## Participación sembrada — ${sembrado.abiertas} abiertas · resuelta: ${sembrado.resuelta}\n`);

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

    const rutas: [string, string][] = [
      ["torneos", "/torneos"],
      ["torneo-detalle", `/torneos/${activo?.id ?? ""}`],
      ["pickems", "/pickems"],
    ];

    for (const [w, h, tag] of VIEWPORTS) {
      console.log(`\n## ${w}×${h}`);
      await tab.resize(w, h, 1);

      for (const [nombre, ruta] of rutas) {
        await tab.goto(`${BASE}${ruta}`, 3200);
        // El panel de predicciones carga en dos tiempos; se le da margen.
        await sleep(nombre === "torneos" ? 900 : 1600);
        // Con más de un Pick'em la pantalla abre en el SELECTOR y el panel no existe
        // todavía. Se entra en el que está vivo: es lo que hace un jugador, y sin eso
        // la mitad de los estados que hay que fotografiar no llegan a pintarse.
        if (nombre === "pickems") { await abrirPickemActivo(tab); }
        // El resumen automático de resultado tapa la pantalla: se cierra para
        // fotografiar lo que hay debajo, y se fotografía aparte más abajo.
        await cerrarModal(tab);
        await tab.shot(join(OUT, `${ETIQUETA}-${tag}-${nombre}.png`));
        // Y la página ENTERA: estas dos pantallas miden varios viewports de alto, y
        // el recorte del pliegue no enseña ni los partidos ni la clasificación.
        await shotCompleta(tab, join(OUT, `${ETIQUETA}-${tag}-${nombre}-completa.png`), w, h);

        const m = await tab.js<any>(METRICAS);
        const t = await tab.js<any>(TACTIL);
        console.log(`   ${nombre.padEnd(16)} pag ${String(m.pagina).padStart(5)} / vp ${m.vp} · scroll ×${m.scrollDepth} · overflowX ${m.overflowX}`);
        console.log(`     dom ${m.dom} · redondeados ${m.redondeados} · píldoras>24px ${m.pildorasGrandes} (de ${m.pildoras}) · chaflanes ${m.chaflanes}`);
        console.log(`     sombras proyectadas ${m.sombrasProyectadas} (de ${m.sombras}) · tamaños de letra distintos ${m.tamanosDeLetra}`);
        console.log(`     clases: rounded ${m.clsRounded} · rounded-full ${m.clsRoundedFull} · text-[px] ${m.clsTextPx} · shadow ${m.clsShadow}`);
        console.log(`     primitivas ${JSON.stringify(m.primitivas)} · select ${m.selects} · input ${m.inputs}`);
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

      // Resumen automático de resultado: se abre solo la primera vez tras una corrección.
      await tab.js(`(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('drl.pickem-result.')) localStorage.removeItem(k); } catch {} return 1; })()`);
      await tab.goto(`${BASE}/pickems`, 3200);
      await sleep(1800);
      await abrirPickemActivo(tab);
      const hayModal = await tab.js<boolean>(`!!document.querySelector('[role="dialog"]')`);
      await tab.shot(join(OUT, `${ETIQUETA}-${tag}-pickem-resultado.png`));
      console.log(`   ${tag} · resumen de resultado: ${hayModal ? "abierto" : "NO SALIÓ"}`);
      await cerrarModal(tab);

      // Torneo sin Pick'ems / vacío: el otro evento del circuito.
      const otro = (eventos ?? []).find((e) => e.id !== activo?.id);
      if (otro) {
        await tab.goto(`${BASE}/torneos/${otro.id}`, 3000);
        await sleep(1200);
        await tab.shot(join(OUT, `${ETIQUETA}-${tag}-torneo-finalizado.png`));
      }

      // Error / no encontrado: una ficha que no existe.
      await tab.goto(`${BASE}/torneos/no-existe-${Date.now()}`, 3000);
      await sleep(900);
      await tab.shot(join(OUT, `${ETIQUETA}-${tag}-torneo-no-encontrado.png`));
    }

    /* ── Teclado y movimiento reducido ── */
    console.log("\n## Teclado y movimiento reducido (1440)");
    await tab.resize(1440, 900, 1);
    await tab.setMedia([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await tab.goto(`${BASE}/pickems`, 3200);
    await sleep(1600);
    await abrirPickemActivo(tab);
    await cerrarModal(tab);
    const conMov = await tab.js<any>(RESUMEN);
    await tab.shot(join(OUT, `${ETIQUETA}-motion-con-movimiento.png`));

    await tab.setMedia([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await tab.goto(`${BASE}/pickems`, 3200);
    await sleep(1600);
    await abrirPickemActivo(tab);
    await cerrarModal(tab);
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
        opciones: foco.filter(e => e.hasAttribute('aria-pressed')).length,
        conFocoVisible: foco.filter(e => {
          const cs = getComputedStyle(e, ':focus-visible');
          return cs.outlineStyle !== 'none' || /ring|nx-focus/.test(e.className || '');
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

/** Lo que la pantalla dice, resumido: sirve para comparar con y sin movimiento. */
const RESUMEN = `(() => {
  const t = document.body.innerText.replace(/\\s+/g, ' ').trim();
  return {
    largo: t.length,
    nodos: document.querySelectorAll('*').length,
    opciones: document.querySelectorAll('[aria-pressed]').length,
    barras: document.querySelectorAll('[role="progressbar"]').length,
  };})()`;


/**
 * Captura la página COMPLETA estirando el viewport hasta su alto.
 *
 * `Page.captureScreenshot` con `captureBeyondViewport` no respeta `position: sticky` ni los
 * elementos fijos, así que la cabecera salía repetida o flotando a media página. Estirar el
 * viewport y devolverlo a su sitio da la foto real de la pantalla larga.
 */
async function shotCompleta(tab: Tab, file: string, w: number, h: number): Promise<void> {
  const alto = await tab.js<number>(`Math.min(document.documentElement.scrollHeight, 8000)`);
  if (alto <= h + 40) return;              // cabe en el pliegue: no hay nada que estirar
  await tab.resize(w, alto, 1);
  await sleep(700);
  await tab.shot(file);
  await tab.resize(w, h, 1);
  await sleep(400);
}

/** Entra en el Pick'em del torneo vivo cuando la pantalla abre en el selector. */
async function abrirPickemActivo(tab: Tab): Promise<void> {
  const abierto = await tab.js<boolean>(`(() => {
    // El panel ya está: hay opciones de predicción.
    if (document.querySelector('[aria-pressed]')) return true;
    const b = [...document.querySelectorAll('button')]
      .find(x => /abiertas/i.test(x.textContent || ''))
      || [...document.querySelectorAll('button')].find(x => /pts/i.test(x.textContent || ''));
    if (b) { b.click(); return false; }
    return true;
  })()`);
  if (!abierto) await sleep(2200);
}

/** Cierra el resumen automático de resultado si está abierto. */
async function cerrarModal(tab: Tab): Promise<void> {
  await tab.js(`(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return 0;
    const b = [...d.querySelectorAll('button')].find(x => /Entendido|Cerrar/i.test(x.getAttribute('aria-label') || x.textContent || ''));
    if (b) b.click();
    return 1;
  })()`);
  await sleep(400);
}

/**
 * Siembra la PARTICIPACIÓN del usuario de auditoría.
 *
 * Las preguntas abiertas se responden con `submitPick`, el servicio real del producto. La
 * pregunta ya corregida no acepta predicciones (el servidor devuelve 409, y así debe ser),
 * así que su respuesta se escribe como FIXTURE con la clave de servicio — exactamente lo
 * que haría el usuario si hubiera llegado a tiempo. Aquí no se decide ningún resultado: el
 * `correct_option` es el que ya tiene el producto.
 */
async function sembrarParticipacion(
  sb: SupabaseClient, userId: string, pickemEventId: string,
): Promise<{ abiertas: number; resuelta: string }> {
  const { data: qs } = await sb.from("pickem_questions_public")
    .select("id, prompt, options, locked, correct_option, points")
    .eq("pickem_event_id", pickemEventId);
  const preguntas = (qs ?? []) as {
    id: string; prompt: string; options: { key: string; label: string }[];
    locked: boolean; correct_option: string | null; points: number;
  }[];

  // Abiertas: por el camino real. Se deja una SIN responder, para fotografiar «pendiente».
  const abiertas = preguntas.filter((q) => !q.locked);
  let n = 0;
  for (const q of abiertas.slice(0, Math.max(0, abiertas.length - 1))) {
    const r = await submitPick(sb, userId, q.id, q.options[0].key);
    if (r.ok) n++;
  }

  // Corregida: fixture, para poder ver «acertada» y «fallada».
  const resuelta = preguntas.find((q) => q.locked && q.correct_option);
  let etiqueta = "ninguna";
  if (resuelta) {
    const otra = resuelta.options.find((o) => o.key !== resuelta.correct_option);
    const elegida = ANSWER === "fallada" && otra ? otra.key : resuelta.correct_option!;
    const { data: sub } = await sb.from("pickem_submissions")
      .upsert({ user_id: userId, pickem_event_id: pickemEventId }, { onConflict: "user_id,pickem_event_id" })
      .select("id").maybeSingle();
    if (sub) {
      await sb.from("pickem_answers").upsert(
        { submission_id: (sub as { id: string }).id, question_id: resuelta.id, option_key: elegida },
        { onConflict: "submission_id,question_id" },
      );
      etiqueta = `${ANSWER} (${elegida})`;
    }
    // El corrector REAL reparte los puntos: aquí no se calcula ninguno.
    await scorePickemEvent(sb, pickemEventId).catch(() => undefined);
  }
  return { abiertas: n, resuelta: etiqueta };
}

main().catch((e: unknown) => { console.error("\n❌", e instanceof Error ? e.message : e); process.exit(1); });
