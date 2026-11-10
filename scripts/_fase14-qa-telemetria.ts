/**
 * FASE 14 · QA REAL DE TELEMETRÍA (instrumento, NO forma parte de CI).
 *
 *   npx tsx scripts/_fase14-qa-telemetria.ts
 *
 * Los dos scripts `telemetry:*` prueban el modelo y el endpoint atacándolos directamente.
 * Este hace lo único que ninguno de los dos puede hacer: **usar el producto**. Abre un
 * navegador de verdad, navega como un jugador, y después mira qué llegó a la base de
 * datos.
 *
 * Es la diferencia entre «el endpoint acepta un zone_entered» y «entrar en el mercado
 * genera un zone_entered de la zona mercado». Lo segundo es lo que se está afirmando.
 *
 * Cubre: sesión anónima, recorrido por zonas, refresco, apertura del constructor de mazos,
 * inicio de sesión conservando la sesión, caducidad a los 30 minutos, un error de cliente
 * provocado, y las dos resoluciones (390 y 1440).
 *
 * Borra la cuenta y los eventos que crea.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

interface Row {
  event_name: string; zone: string | null; flow: string | null;
  severity: string | null; source: string | null;
  session_id: string | null; user_id: string | null;
  environment: string; app_version: string | null;
  metadata: Record<string, unknown>; occurred_at: string;
}

const rowsOf = async (sessionIds: string[]): Promise<Row[]> => {
  if (sessionIds.length === 0) return [];
  const { data } = await db.from("telemetry_events").select("*")
    .in("session_id", sessionIds).order("id", { ascending: true });
  return (data ?? []) as Row[];
};

/** El identificador de sesión que el cliente tiene guardado ahora mismo. */
const SESSION_JS = `(() => { try {
  const raw = sessionStorage.getItem("nexus.telemetry.session");
  return raw ? JSON.parse(raw).id : null;
} catch { return null; } })()`;

async function main() {
  const ping = await fetch(`${BASE}/`).catch(() => null);
  if (!ping?.ok) { console.error(`No hay servidor en ${BASE}.`); process.exit(1); }

  console.log(`\n═══ QA REAL DE TELEMETRÍA — ${BASE} ═══\n`);

  const email = `qa14-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: creada, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `qa14${Date.now().toString(36)}` },
  });
  if (error || !creada.user) throw new Error(error?.message ?? "no se pudo crear la cuenta");
  const userId = creada.user.id;

  const sesiones: string[] = [];
  const browser = await launch();
  const tab = browser.tab;

  try {
    // ══════════════ 1. VISITANTE ANÓNIMO ══════════════
    console.log("VISITANTE ANÓNIMO");
    await tab.resize(1440, 900, 1);
    await tab.goto(`${BASE}/`, 3000);
    await sleep(2000);

    const s1 = await tab.js<string | null>(SESSION_JS);
    if (s1) sesiones.push(s1);
    check("1 · al entrar se crea una sesión en sessionStorage", !!s1, s1 ?? "(ninguna)");

    let filas = await rowsOf(sesiones);
    check("2 · se emitió session_started",
      filas.some((r) => r.event_name === "session_started"),
      `${filas.length} eventos`);
    check("3 · el evento anónimo va sin user_id",
      filas.every((r) => r.user_id === null));

    const inicio = filas.find((r) => r.event_name === "session_started");
    check("4 · session_started lleva zona de entrada, origen y viewport",
      !!inicio && inicio.metadata.entry_zone === "home"
        && typeof inicio.metadata.referrer_kind === "string"
        && inicio.metadata.viewport === "desktop",
      JSON.stringify(inicio?.metadata));

    // ══════════════ 2. RECORRIDO POR ZONAS ══════════════
    console.log("\nRECORRIDO");
    for (const ruta of ["/coleccion", "/mercado", "/duelos", "/pickems", "/entrenador"]) {
      await tab.goto(`${BASE}${ruta}`, 2600);
      await sleep(1300);
    }
    filas = await rowsOf(sesiones);
    const zonas = filas.filter((r) => r.event_name === "zone_entered").map((r) => r.zone);
    check("5 · cada zona visitada generó su zone_entered",
      ["collection", "market", "duel_hub", "pickems", "trainer"].every((z) => zonas.includes(z)),
      zonas.join(", "));

    check("6 · las zonas son del enum, nunca una URL",
      zonas.every((z) => typeof z === "string" && !z.includes("/")));

    check("7 · todos los eventos comparten la MISMA sesión",
      new Set(filas.map((r) => r.session_id)).size === 1);

    /*
     * `from_zone` solo puede existir en navegación SPA: en una carga dura el módulo se
     * reinicia y el cliente no sabe —honestamente— de dónde venía. Así que se prueba
     * pulsando un enlace del armazón, que es como navega un jugador de verdad.
     */
    const navegado = await tab.js<string | null>(`(() => {
      const a = [...document.querySelectorAll('nav a[href]')].find((x) => x.getAttribute('href') === '/tienda');
      if (!a) return null; a.click(); return '/tienda';
    })()`);
    await sleep(2400);
    filas = await rowsOf(sesiones);
    check("8 · navegando por la interfaz, zone_entered encadena de dónde viene",
      filas.some((r) => r.event_name === "zone_entered" && r.zone === "store" && typeof r.metadata.from_zone === "string"),
      navegado ? `desde ${filas.find((r) => r.zone === "store")?.metadata.from_zone}` : "no se encontró el enlace");

    // ══════════════ 3. REFRESCO ══════════════
    console.log("\nREFRESCO");
    const antesRefresco = filas.length;
    await tab.goto(`${BASE}/entrenador`, 2600);   // misma zona, recargada
    await sleep(1500);
    const trasRefresco = await rowsOf(sesiones);
    const s1b = await tab.js<string | null>(SESSION_JS);

    check("9 · un refresco NO abre una sesión nueva", s1b === s1, `${s1b?.slice(0, 8)}…`);
    check("10 · un refresco NO emite un segundo session_started",
      trasRefresco.filter((r) => r.event_name === "session_started").length === 1);
    check("11 · recargar la misma zona no la cuenta dos veces seguidas",
      trasRefresco.length <= antesRefresco + 1,
      `${antesRefresco} → ${trasRefresco.length}`);

    // ══════════════ 4. INICIO DE SESIÓN ══════════════
    console.log("\nINICIO DE SESIÓN");
    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: si } = await pub.auth.signInWithPassword({ email, password });
    const storageKey = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;
    await tab.setStorage(storageKey, JSON.stringify(si!.session!));

    await tab.goto(`${BASE}/cuenta`, 2800);
    await sleep(2000);
    const s1c = await tab.js<string | null>(SESSION_JS);
    check("14 · el session_id sobrevive al inicio de sesión", s1c === s1, `${s1c?.slice(0, 8)}…`);

    await tab.goto(`${BASE}/logros`, 2600);
    await sleep(1800);
    filas = await rowsOf(sesiones);
    const conUsuario = filas.filter((r) => r.user_id === userId);
    check("15 · los eventos posteriores ya llevan el usuario", conUsuario.length > 0,
      `${conUsuario.length} de ${filas.length}`);
    check("16 · la sesión queda atribuible entera: anónima + autenticada, un solo session_id",
      new Set(filas.map((r) => r.session_id)).size === 1
        && filas.some((r) => r.user_id === null) && filas.some((r) => r.user_id === userId));

    /*
     * Va DESPUÉS del inicio de sesión y no antes: `/duelos/mazos` exige cuenta, así que un
     * visitante anónimo ve la pantalla de «necesitas una cuenta» y el botón del constructor
     * no existe. La primera versión de este QA lo probaba en anónimo y fallaba por eso, no
     * por la telemetría.
     */
    // ══════════════ 5. FLUJO: EL CONSTRUCTOR DE MAZOS ══════════════
    console.log("\nFLUJO (constructor de mazos)");
    await tab.goto(`${BASE}/duelos/mazos`, 3000);
    await sleep(2200);
    const pulsado = await tab.js<string | null>(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /primer mazo|nuevo mazo/i.test(x.innerText || ''));
      if (!b) return null; b.click(); return (b.innerText || '').trim();
    })()`);
    await sleep(2200);
    filas = await rowsOf(sesiones);
    const flujo = filas.find((r) => r.event_name === "flow_started");

    check("16b · abrir el constructor emite flow_started", !!flujo, pulsado ?? "no se encontró el botón");
    check("16c · …con el flujo correcto y sin cambiar de ruta",
      flujo?.flow === "deck_builder" && flujo?.zone === null,
      `flow=${flujo?.flow} zone=${flujo?.zone}`);


    // ══════════════ 6. ERROR DE CLIENTE ══════════════
    console.log("\nERROR DE CLIENTE (provocado)");
    const antesError = filas.length;
    // Un error no controlado de verdad: se lanza fuera de la pila de React, que es lo que
    // captura `window.onerror`.
    await tab.js(`setTimeout(() => { throw new Error("QA14 fallo provocado con token eyJhbGciOiJIUzI1NiJ9.eyJzIjoxfQ.zzz y correo qa@ejemplo.com"); }, 0)`);
    await sleep(2500);
    filas = await rowsOf(sesiones);
    const errores = filas.filter((r) => r.event_name === "error_captured");

    check("17 · el error no controlado llega como error_captured", errores.length >= 1,
      `${errores.length} errores`);
    check("18 · con origen cliente y severidad error (no critical: el manejador global no sabe el flujo)",
      errores.every((e) => e.source === "client" && e.severity === "error"));

    const msg = String(errores[0]?.metadata?.message ?? "");
    check("19 · el token y el correo van redactados",
      msg.includes("[REDACTED") && !msg.includes("eyJhbGciOiJIUzI1NiJ9") && !msg.includes("qa@ejemplo.com"),
      msg.slice(0, 90));
    check("20 · no viaja el stack ni recentLogs",
      errores.every((e) => !("stack" in e.metadata) && !("recentLogs" in e.metadata)),
      Object.keys(errores[0]?.metadata ?? {}).join(","));

    // Repetir el MISMO error no debe generar más filas: la huella lo descarta.
    const antesRepe = errores.length;
    for (let i = 0; i < 3; i++) {
      await tab.js(`setTimeout(() => { throw new Error("QA14 fallo provocado con token eyJhbGciOiJIUzI1NiJ9.eyJzIjoxfQ.zzz y correo qa@ejemplo.com"); }, 0)`);
      await sleep(700);
    }
    await sleep(1500);
    filas = await rowsOf(sesiones);
    const despuesRepe = filas.filter((r) => r.event_name === "error_captured").length;
    check("21 · el mismo error repetido no se manda otra vez (huella)",
      despuesRepe === antesRepe, `${antesRepe} → ${despuesRepe}`);
    check("22 · no hay bucle: los errores no se multiplican",
      despuesRepe < 10, `${despuesRepe} errores en total`);

    // ══════════════ 7. LA UX NO SE ROMPE ══════════════
    console.log("\nLA EXPERIENCIA NO SE ROMPE");
    await tab.goto(`${BASE}/coleccion`, 2800);
    await sleep(1600);
    const vivo = await tab.js<any>(`(() => {
      const main = document.querySelector('main');
      return { hayMain: !!main, texto: (main?.innerText || '').length, controles: document.querySelectorAll('button, a[href]').length };
    })()`);
    check("23 · tras los errores, la aplicación sigue navegando y pintando",
      vivo.hayMain && vivo.texto > 200 && vivo.controles > 5,
      `${vivo.texto} caracteres · ${vivo.controles} controles`);

    // ══════════════ 8. CADUCIDAD A LOS 30 MINUTOS ══════════════
    console.log("\nCADUCIDAD DE LA SESIÓN");
    // Se envejece la marca de actividad 31 minutos: es la única forma honesta de probar
    // la ventana sin esperar media hora.
    await tab.js(`(() => {
      const raw = sessionStorage.getItem("nexus.telemetry.session");
      const p = JSON.parse(raw);
      p.seen = Date.now() - 31 * 60 * 1000;
      sessionStorage.setItem("nexus.telemetry.session", JSON.stringify(p));
    })()`);
    await tab.goto(`${BASE}/tienda`, 2800);
    await sleep(2000);
    const s2 = await tab.js<string | null>(SESSION_JS);
    if (s2 && s2 !== s1) sesiones.push(s2);

    check("24 · tras 30 minutos de inactividad nace una sesión NUEVA", !!s2 && s2 !== s1,
      `${s1?.slice(0, 8)}… → ${s2?.slice(0, 8)}…`);
    const nuevas = await rowsOf(s2 ? [s2] : []);
    check("25 · la sesión nueva emite su propio session_started",
      nuevas.some((r) => r.event_name === "session_started"), `${nuevas.length} eventos`);

    // ══════════════ 9. MÓVIL ══════════════
    console.log("\nMÓVIL (390×844)");
    await tab.js(`sessionStorage.removeItem("nexus.telemetry.session")`);
    await tab.resize(390, 844, 1);
    await tab.goto(`${BASE}/`, 3000);
    await sleep(2000);
    const s3 = await tab.js<string | null>(SESSION_JS);
    if (s3) sesiones.push(s3);
    const movil = await rowsOf(s3 ? [s3] : []);
    const inicioMovil = movil.find((r) => r.event_name === "session_started");
    check("26 · en móvil se registra igual y el viewport se detecta",
      inicioMovil?.metadata.viewport === "mobile", String(inicioMovil?.metadata.viewport));

    // ══════════════ 10. LO ESCRITO ══════════════
    console.log("\nLO QUE HA QUEDADO EN LA BASE DE DATOS");
    const todo = await rowsOf(sesiones);
    check("27 · todos los event_name son de la taxonomía",
      todo.every((r) => ["session_started", "zone_entered", "flow_started", "error_captured"].includes(r.event_name)));
    check("28 · todas las filas llevan entorno y versión del servidor",
      todo.every((r) => !!r.environment && !!r.app_version),
      `env=${todo[0]?.environment} ver=${todo[0]?.app_version}`);
    check("29 · ninguna metadata contiene secretos ni PII",
      !/eyJ[A-Za-z0-9_-]{8,}\.|@ejemplo\.com|Bearer [A-Za-z0-9]|cookie=|authorization/i.test(JSON.stringify(todo.map((r) => r.metadata))));

    const porEvento = todo.reduce<Record<string, number>>((a, r) => {
      a[r.event_name] = (a[r.event_name] ?? 0) + 1; return a;
    }, {});
    console.log(`\n  Resumen: ${todo.length} eventos · ${JSON.stringify(porEvento)}`);
    console.log(`  Sesiones: ${sesiones.length}`);

    // ══════════════ 11. AISLAMIENTO ══════════════
    console.log("\nAISLAMIENTO");
    const { data: libro } = await db.from("credit_transactions").select("reason").eq("user_id", userId);
    check("30 · navegar con telemetría no movió el libro mayor",
      (libro ?? []).length === 1 && (libro ?? [])[0].reason === "starter_grant",
      (libro ?? []).map((x) => x.reason).join(", "));
  } finally {
    await browser.close().catch(() => {});
    await db.from("telemetry_events").delete().in("session_id", sesiones);
    await db.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${pass} correctas · ${fail} fallidas`);
  console.log(fail === 0 ? "  ✅ LA TELEMETRÍA FUNCIONA EN EL PRODUCTO REAL\n" : "  ❌ HAY FALLOS\n");
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error("\n❌", e); process.exit(1); });
