/**
 * FASE 14 · QA REAL DE LIVE OPERATIONS (instrumento, NO forma parte de CI).
 *
 *   npx tsx scripts/_fase14-qa-operations.ts
 *
 * `operations:verify` ataca el endpoint. Este abre la PANTALLA en un navegador de verdad,
 * con las dos resoluciones, y comprueba lo que solo se ve mirando: que no desborda, que no
 * hay errores de consola, que un usuario normal no ve datos, y que los vacíos se dicen con
 * palabras en vez de con un cero.
 *
 * Siembra telemetría para que la consola tenga algo que enseñar —una sala de control vacía
 * no prueba nada— y lo borra todo al terminar.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { launch, sleep } from "./lib/cdp";

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
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const OUT = join(ROOT, "docs", "product", "qa", "fase14");

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

/** Lo que solo se puede comprobar mirando la página renderizada. */
const MEDIDA = `(() => {
  const t = document.body.innerText || '';
  // Las medidas de DISEÑO se acotan a <main>. El armazón tiene sus propias cápsulas
  // —deuda conocida de la Fase 12— y contarlas aquí culparía a esta pantalla de algo
  // que no es suyo.
  const main = document.querySelector('main') || document.body;
  return {
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    texto: t.length,
    // Primitivas del sistema, por su marca de superficie.
    primitivas: main.querySelectorAll('[data-surface]').length,
    // Chaflanes: la geometría de la casa.
    chaflanes: [...main.querySelectorAll('*')].filter((e) => {
      const c = getComputedStyle(e).clipPath;
      return c && c.startsWith('polygon');
    }).length,
    /*
     * Cápsulas DECORATIVAS. Se excluye la primitiva \`Meter\` del sistema, que es una
     * barra de progreso y lleva los extremos redondeados a propósito —\`role=progressbar\`
     * la identifica—. Contarla aquí sería culpar a esta pantalla de una decisión del
     * sistema de diseño, compartida con todo el producto.
     */
    capsulas: [...main.querySelectorAll('*')].filter((e) => {
      if (parseFloat(getComputedStyle(e).borderRadius) < 999) return false;
      // La barra de progreso del sistema lleva los extremos redondeados a propósito.
      if (e.closest('[role="progressbar"]')) return false;
      // Un PUNTO de estado es redondo por definición; no es una cápsula. Se distingue
      // por tamaño: una píldora decorativa nunca mide 10 px de ancho.
      const r = e.getBoundingClientRect();
      if (r.width <= 14 && r.height <= 14) return false;
      return true;
    }).length,
    secciones: [...document.querySelectorAll('h1, h2')].map((h) => (h.innerText || '').trim()).filter(Boolean),
    controles: document.querySelectorAll('button, a[href]').length,
    // Focalizables sin nombre accesible.
    sinNombre: [...main.querySelectorAll('button, a[href]')].filter((e) => {
      const n = (e.innerText || e.getAttribute('aria-label') || '').trim();
      return n.length === 0;
    }).length,
    tieneVacio: /SIN DATOS|Sin cobertura|SIN COBERTURA/i.test(t),
    diceFoto: /Foto del producto/i.test(t),
    diceEstimado: /estimado/i.test(t),
    diceCotaInferior: /cota inferior/i.test(t),
    diceRestringido: /Acceso restringido/i.test(t),
  };
})()`;

async function main() {
  const ping = await fetch(`${BASE}/`).catch(() => null);
  if (!ping?.ok) { console.error(`No hay servidor en ${BASE}.`); process.exit(1); }
  mkdirSync(OUT, { recursive: true });

  console.log(`\n═══ QA REAL DE LIVE OPERATIONS — ${BASE} ═══\n`);

  const cuentas: string[] = [];
  const sesiones: string[] = [];
  const crear = async (etq: string, esAdmin: boolean) => {
    const email = `qops-${etq}-${Date.now()}@example.invalid`;
    const password = ephemeralQaPassword();
    const { data, error } = await db.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { username: `qops${etq}${Date.now().toString(36)}` },
    });
    if (error || !data.user) throw new Error(error?.message ?? "no se pudo crear");
    cuentas.push(data.user.id);
    if (esAdmin) await db.from("profiles").update({ is_admin: true }).eq("id", data.user.id);
    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: si } = await pub.auth.signInWithPassword({ email, password });
    return { id: data.user.id, session: si!.session! };
  };

  const browser = await launch();
  const tab = browser.tab;
  const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

  try {
    const admin = await crear("admin", true);
    const normal = await crear("user", false);

    // ══════════ CONSOLA VACÍA: el caso que más importa decir bien ══════════
    console.log("CONSOLA SIN COBERTURA (telemetría vacía)");
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/`, 2000);
    await tab.setStorage(storageKey, JSON.stringify(admin.session));
    await tab.goto(`${BASE}/admin/operations`, 3200);
    await sleep(2600);
    let m = await tab.js<any>(MEDIDA);
    await tab.shot(join(OUT, "operations-1440-sin-cobertura.png"));

    check("1 · la consola carga para un administrador", m.texto > 400, `${m.texto} caracteres`);
    check("2 · un cero ambiguo se dice «sin cobertura», no como dato", m.tieneVacio);
    check("3 · no dice «en directo»: dice que es una foto con su antigüedad", m.diceFoto);

    // ══════════ CON DATOS ══════════
    console.log("\nCONSOLA CON DATOS");
    const s1 = randomUUID(); sesiones.push(s1);
    const s2 = randomUUID(); sesiones.push(s2);
    const ahora = Date.now();
    const T = (min: number) => new Date(ahora - min * 60_000).toISOString();

    const filas: Record<string, unknown>[] = [
      { event_name: "session_started", user_id: null, session_id: s1, environment: "test",
        app_version: "0.1.1", metadata: { entry_zone: "home", viewport: "desktop" }, occurred_at: T(40) },
      { event_name: "zone_entered", user_id: null, session_id: s1, zone: "home",
        environment: "test", app_version: "0.1.1", metadata: { is_first_of_session: true }, occurred_at: T(40) },
      { event_name: "zone_entered", user_id: normal.id, session_id: s1, zone: "duel_hub",
        environment: "test", app_version: "0.1.1", metadata: { from_zone: "home" }, occurred_at: T(38) },
      { event_name: "zone_entered", user_id: normal.id, session_id: s1, zone: "market",
        environment: "test", app_version: "0.1.1", metadata: {}, occurred_at: T(36) },
      { event_name: "flow_started", user_id: normal.id, session_id: s1, flow: "deck_builder",
        environment: "test", app_version: "0.1.1", metadata: { flow: "deck_builder" }, occurred_at: T(35) },
      { event_name: "session_started", user_id: admin.id, session_id: s2, environment: "test",
        app_version: "0.1.2", metadata: { entry_zone: "pickems", viewport: "mobile" }, occurred_at: T(20) },
      { event_name: "zone_entered", user_id: admin.id, session_id: s2, zone: "pickems",
        environment: "test", app_version: "0.1.2", metadata: { is_first_of_session: true }, occurred_at: T(20) },
      // Un error CRÍTICO, que es lo que la consola tiene que gritar.
      { event_name: "error_captured", user_id: normal.id, session_id: s1, source: "client",
        severity: "critical", zone: "duel_play", environment: "test",
        app_version: "0.1.2",
        metadata: { code: "RENDER_ERROR", message: "fallo de prueba en el duelo", fingerprint: "qa-ops-1" },
        occurred_at: T(15) },
      { event_name: "error_captured", user_id: normal.id, session_id: s1, source: "client",
        severity: "critical", zone: "duel_play", environment: "test",
        app_version: "0.1.2",
        metadata: { code: "RENDER_ERROR", message: "fallo de prueba en el duelo", fingerprint: "qa-ops-1" },
        occurred_at: T(14) },
      { event_name: "error_captured", user_id: null, session_id: s2, source: "server",
        severity: "warn", zone: "market", environment: "test", app_version: "0.1.1",
        metadata: { code: "HTTP_500", message: "otro fallo de prueba", fingerprint: "qa-ops-2" },
        occurred_at: T(10) },
    ];
    /*
     * Se comprueba el error de la inserción. La primera versión no lo hacía y una sola
     * fila inválida —un `flow` que en realidad era una zona— tumbó el lote ENTERO sin
     * decir nada: la consola salía vacía y parecía un fallo de la consola.
     *
     * Que la restricción lo rechazara es exactamente lo que tiene que pasar. Lo que
     * estaba mal era el dato de prueba.
     */
    /*
     * Y una partida terminada: sin duelos, la sección de Duelos enseña su estado vacío
     * —que es lo correcto— y entonces no puede comprobarse la etiqueta «ESTIMADO».
     */
    await db.from("duel_matches").insert({
      user_id: normal.id, deck_id: null, difficulty: "NORMAL", status: "COMPLETED",
      winner: "A", state: {}, rng: {}, rules_version: "qa-ops", created_at: T(30),
    });

    const { error: eSiembra } = await db.from("telemetry_events").insert(filas);
    check("3b · la siembra de telemetría entra (el CHECK acepta datos válidos)",
      !eSiembra, eSiembra?.message?.slice(0, 80) ?? "");

    await tab.goto(`${BASE}/admin/operations`, 3200);
    await sleep(2800);
    m = await tab.js<any>(MEDIDA);
    await tab.shot(join(OUT, "operations-1440.png"));

    check("4 · con datos, la consola se llena", m.texto > 800, `${m.texto} caracteres`);
    check("5 · están las ocho secciones",
      ["Estado", "Errores", "Primera experiencia", "Duelos", "Actividad", "Zonas", "Pick'ems", "Mercado"]
        .every((t) => m.secciones.some((s: string) => s.toLowerCase().includes(t.toLowerCase()))),
      m.secciones.join(" · "));

    const txt = await tab.js<string>("document.body.innerText");
    // OJO: /crítico/i también casa con «Sin errores críticos», que es lo contrario.
    // Se busca la insignia de alarma, que solo aparece cuando de verdad hay uno.
    // El CSS pone versalitas y `innerText` las devuelve YA en mayúsculas: toda
    // comparación de texto de esta pantalla tiene que ignorar mayúsculas.
    check("6 · el error crítico se ve inmediatamente",
      /\d+\s+error(es)?\s+crítico/i.test(txt), (txt.match(/.{0,24}crítico.{0,10}/i) ?? [""])[0]);
    check("7 · el error aparece agrupado con su número de apariciones", /2\s+veces/i.test(txt));
    check("8 · se ve la versión afectada", /v0\.1\.2/i.test(txt));
    check("9 · el abandono de duelo se etiqueta ESTIMADO", m.diceEstimado);
    check("10 · la duración de sesión se etiqueta COTA INFERIOR", m.diceCotaInferior);
    check("11 · las zonas separan usuarios, sesiones y entradas",
      /usuarios/i.test(txt) && /sesiones/i.test(txt) && /entradas/i.test(txt));
    check("12 · se ven las sesiones MIXTAS (anónima → autenticada)", /mixtas/i.test(txt));

    // ══════════ DISEÑO ══════════
    console.log("\nDISEÑO");
    check("13 · usa las primitivas del sistema", m.primitivas >= 8, `${m.primitivas} superficies`);
    check("14 · usa la geometría de la casa (chaflanes)", m.chaflanes >= 5, `${m.chaflanes}`);
    check("15 · sin cápsulas decorativas (ni barra Meter ni punto de estado son cápsulas)",
      m.capsulas === 0, `${m.capsulas}`);
    check("16 · sin focalizables sin nombre", m.sinNombre === 0, `${m.sinNombre}`);
    check("17 · sin desbordamiento horizontal en escritorio", m.overflowX === 0, `${m.overflowX}px`);

    const errores1440 = tab.takeErrors();
    check("18 · sin errores de consola en escritorio", errores1440.length === 0,
      errores1440.slice(0, 2).join(" · "));

    // ══════════ MÓVIL ══════════
    console.log("\nMÓVIL (390×844)");
    await tab.resize(390, 844, 1);
    await tab.goto(`${BASE}/admin/operations`, 3200);
    await sleep(2800);
    const mm = await tab.js<any>(MEDIDA);
    await tab.shot(join(OUT, "operations-390.png"));

    check("19 · sin desbordamiento horizontal a 390px", mm.overflowX === 0, `${mm.overflowX}px`);
    check("20 · el contenido sigue completo en móvil", mm.texto > 800, `${mm.texto} caracteres`);
    check("21 · las secciones siguen ahí", mm.secciones.length >= 6, `${mm.secciones.length}`);
    const erroresMovil = tab.takeErrors();
    check("22 · sin errores de consola en móvil", erroresMovil.length === 0,
      erroresMovil.slice(0, 2).join(" · "));

    // ══════════ USUARIO NORMAL ══════════
    console.log("\nUSUARIO NORMAL");
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/`, 2000);
    await tab.setStorage(storageKey, JSON.stringify(normal.session));
    await tab.goto(`${BASE}/admin/operations`, 3200);
    await sleep(2600);
    const mu = await tab.js<any>(MEDIDA);
    const txtUsuario = await tab.js<string>("document.body.innerText");
    await tab.shot(join(OUT, "operations-1440-sin-permiso.png"));

    check("23 · un usuario normal ve «Acceso restringido»", mu.diceRestringido);
    check("24 · …y NO ve ninguna métrica",
      !/Primera experiencia|Abandono estimado|Cota inferior|DAU/i.test(txtUsuario),
      txtUsuario.replace(/\n/g, " ").slice(0, 80));
    check("25 · …y se le ofrece una salida", /Volver a NEXUS/i.test(txtUsuario));

    // ══════════ SIN SESIÓN ══════════
    console.log("\nSIN SESIÓN");
    await tab.js(`localStorage.clear()`);
    await tab.goto(`${BASE}/admin/operations`, 3200);
    await sleep(2600);
    const txtAnon = await tab.js<string>("document.body.innerText");
    await tab.shot(join(OUT, "operations-1440-sin-sesion.png"));
    check("26 · sin sesión se pide iniciar sesión", /iniciar sesión/i.test(txtAnon));
    check("27 · …y tampoco hay métricas",
      !/Primera experiencia|Abandono estimado|DAU/i.test(txtAnon));
  } finally {
    await browser.close().catch(() => {});
    await db.from("telemetry_events").delete().in("session_id", sesiones);
    // Las partidas y demás cuelgan de la cuenta y se van en cascada al borrarla.
    for (const id of cuentas) await db.auth.admin.deleteUser(id).catch(() => {});
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${pass} correctas · ${fail} fallidas`);
  console.log(fail === 0 ? "  ✅ LA SALA DE CONTROL FUNCIONA\n" : "  ❌ HAY FALLOS\n");
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error("\n❌", e); process.exit(1); });
