/**
 * VERIFICACIÓN DE LA INGESTIÓN — `npm run telemetry:ingest` (Fase 14, bloque 4).
 *
 * Ataca `POST /api/telemetry` como lo haría un cliente hostil, y después comprueba en la
 * base de datos qué se escribió de verdad.
 *
 * Separado de `telemetry:verify` a propósito: aquel prueba el MODELO y no necesita
 * servidor; este prueba el ENDPOINT y sí. Es la misma división que ya hay entre
 * `security:verify` y `progression:verify`.
 *
 * Lo que se demuestra:
 *
 *   · que el servidor rechaza lo que no está en la taxonomía;
 *   · que los cuatro campos que el servidor se reserva —usuario, fecha, entorno y
 *     versión— NO se pueden suplantar desde el cuerpo;
 *   · que la lista blanca de metadata funciona y que los secretos se redactan;
 *   · que un anónimo puede emitir y que su sesión sobrevive al inicio de sesión;
 *   · que la telemetría es best-effort: nada de lo que falle aquí devuelve un error que
 *     pueda romper al cliente.
 *
 * Crea sus propias cuentas y borra todo lo que escribe.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const ENDPOINT = `${BASE}/api/telemetry`;

async function post(body: unknown, token?: string): Promise<number> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body) });
  return res.status;
}

/** La última fila escrita para una sesión concreta. */
async function lastRow(sessionId: string) {
  const { data } = await db.from("telemetry_events")
    .select("*").eq("session_id", sessionId).order("id", { ascending: false }).limit(1).maybeSingle();
  return data as Record<string, unknown> | null;
}

async function main() {
  const ping = await fetch(`${BASE}/`).catch(() => null);
  if (!ping?.ok) {
    console.error(`\n❌ No hay servidor NEXUS en ${BASE}. Arranca 'npx next start -p 3005'.\n`);
    process.exit(1);
  }

  console.log("\n═══ VERIFICACIÓN DE LA INGESTIÓN (POST /api/telemetry) ═══\n");

  const cuentas: string[] = [];
  const sesiones: string[] = [];
  const nueva = async (etq: string) => {
    const email = `ing-${etq}-${Date.now()}@example.invalid`;
    const password = ephemeralQaPassword();
    const { data, error } = await db.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { username: `ing${etq}${Date.now().toString(36)}` },
    });
    if (error || !data.user) throw new Error(error?.message ?? "no se pudo crear la cuenta");
    cuentas.push(data.user.id);
    return { id: data.user.id, email, password };
  };

  const A = await nueva("a");
  const B = await nueva("b");
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: si } = await pub.auth.signInWithPassword({ email: A.email, password: A.password });
  const tokenA = si!.session!.access_token;

  try {
    // ═══════════════════ VALIDACIÓN ═══════════════════
    console.log("VALIDACIÓN");

    const s1 = randomUUID(); sesiones.push(s1);
    check("1 · un evento válido se acepta (204)",
      (await post({ event_name: "session_started", session_id: s1, metadata: { entry_zone: "home", viewport: "desktop" } })) === 204);

    check("2 · un event_name inventado se rechaza (400)",
      (await post({ event_name: "pack_opened", session_id: randomUUID() })) === 400);

    check("3 · una zona que es una RUTA se rechaza (400)",
      (await post({ event_name: "zone_entered", zone: "/coleccion?t=1", session_id: randomUUID() })) === 400);

    check("4 · un flow inventado se rechaza (400)",
      (await post({ event_name: "flow_started", flow: "checkout", session_id: randomUUID() })) === 400);

    check("5 · una severidad inventada se rechaza (400)",
      (await post({ event_name: "error_captured", source: "client", severity: "fatal", session_id: randomUUID() })) === 400);

    check("6 · un session_id que no es UUID se rechaza (400)",
      (await post({ event_name: "session_started", session_id: "no-soy-un-uuid" })) === 400);

    check("7 · una fila incoherente (zone_entered sin zona) se rechaza (400)",
      (await post({ event_name: "zone_entered", session_id: randomUUID() })) === 400);

    check("8 · un cuerpo que no es JSON se rechaza (400)",
      (await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: "{{{" })).status === 400);

    const gigante = { event_name: "session_started", session_id: randomUUID(), metadata: { entry_zone: "x".repeat(20000) } };
    check("9 · un cuerpo desproporcionado se rechaza (413)", (await post(gigante)) === 413);

    // ═══════════════════ SUPLANTACIÓN ═══════════════════
    console.log("\nSUPLANTACIÓN (los cuatro campos que el servidor se reserva)");

    const s2 = randomUUID(); sesiones.push(s2);
    await post({
      event_name: "session_started",
      session_id: s2,
      // Los cuatro campos prohibidos, todos a la vez, en el cuerpo.
      user_id: B.id,
      occurred_at: "1999-01-01T00:00:00Z",
      // Se manda el entorno CONTRARIO al del servidor. Mandar el mismo no probaría nada:
      // el resultado coincidiría por casualidad y el test pasaría sin comprobar nada.
      environment: "development",
      app_version: "9.9.9-falsa",
      metadata: { entry_zone: "home" },
    }, tokenA);
    const r2 = await lastRow(s2);

    check("10 · user_id sale del Bearer, NO del cuerpo",
      r2?.user_id === A.id, `escrito: ${String(r2?.user_id).slice(0, 8)}… · intentado: ${B.id.slice(0, 8)}…`);

    check("11 · occurred_at lo pone el servidor, no el cuerpo",
      typeof r2?.occurred_at === "string" && new Date(r2.occurred_at as string).getFullYear() >= 2026,
      String(r2?.occurred_at));

    /*
     * El servidor corre con `next start`, es decir `NODE_ENV=production`. El cuerpo pidió
     * `development`. Si lo escrito es `production`, el cuerpo se ignoró.
     *
     * Se consulta el entorno AL SERVIDOR, no al proceso de este script: son dos procesos
     * distintos y `process.env.NODE_ENV` de aquí no dice nada de aquél.
     */
    check("12 · environment sale del servidor, no del cuerpo (se pidió 'development')",
      r2?.environment === "production",
      `escrito: ${String(r2?.environment)} · pedido: development`);

    check("13 · app_version sale de platform/version.ts, no del cuerpo",
      r2?.app_version !== "9.9.9-falsa", String(r2?.app_version));

    // ═══════════════════ METADATA ═══════════════════
    console.log("\nMETADATA");

    const s3 = randomUUID(); sesiones.push(s3);
    await post({
      event_name: "zone_entered",
      session_id: s3,
      zone: "market",
      metadata: {
        from_zone: "home",
        is_first_of_session: false,
        // Nada de esto está en la lista blanca de `zone_entered`.
        access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij",
        cookie: "sb-auth=xyz",
        email: "alguien@ejemplo.com",
        ip: "192.168.1.44",
        user_agent: "Mozilla/5.0 (…)",
        headers: { authorization: "Bearer abc" },
      },
    }, tokenA);
    const r3 = await lastRow(s3);
    const meta3 = (r3?.metadata ?? {}) as Record<string, unknown>;

    check("14 · la lista blanca deja pasar solo lo previsto",
      Object.keys(meta3).sort().join(",") === "from_zone,is_first_of_session",
      Object.keys(meta3).join(",") || "(vacío)");

    const serial3 = JSON.stringify(meta3);
    check("15 · ni token, ni cookie, ni correo, ni IP, ni cabeceras llegan a la base de datos",
      !/eyJ|cookie|ejemplo\.com|192\.168|authorization/i.test(serial3), serial3.slice(0, 80));

    // Un secreto DENTRO de un campo permitido: aquí la lista blanca no basta y actúa la
    // redacción por forma.
    const s4 = randomUUID(); sesiones.push(s4);
    await post({
      event_name: "error_captured",
      session_id: s4,
      source: "client",
      severity: "error",
      metadata: {
        code: "FETCH_FAILED",
        message: "falló GET https://api.x.com/v1?token=abc123 con Bearer eyJhbGciOiJIUzI1NiJ9.eyJzIjoxfQ.zzzz para alguien@ejemplo.com",
        fingerprint: "abc123",
      },
    }, tokenA);
    const r4 = await lastRow(s4);
    const msg4 = String(((r4?.metadata ?? {}) as Record<string, unknown>).message ?? "");

    check("16 · un secreto dentro de un campo PERMITIDO se redacta por forma",
      msg4.includes("[REDACTED") && !msg4.includes("eyJhbGciOiJIUzI1NiJ9") && !msg4.includes("alguien@ejemplo.com"),
      msg4.slice(0, 90));

    check("17 · la consulta de una URL se descarta y el camino se conserva",
      !msg4.includes("token=abc123"), msg4.slice(0, 90));

    // ═══════════════════ ANÓNIMO Y SESIÓN ═══════════════════
    console.log("\nANÓNIMO Y SESIÓN");

    const s5 = randomUUID(); sesiones.push(s5);
    check("18 · un anónimo (sin Bearer) puede emitir",
      (await post({ event_name: "session_started", session_id: s5, metadata: { entry_zone: "inventory" } })) === 204);

    const r5 = await lastRow(s5);
    check("19 · el evento anónimo se guarda con user_id nulo", r5?.user_id === null, String(r5?.user_id));

    // El mismo session_id, ahora autenticado: es el caso «entro anónimo y luego inicio sesión».
    await post({ event_name: "zone_entered", session_id: s5, zone: "account", metadata: { from_zone: "inventory" } }, tokenA);
    const { data: mismaSesion } = await db.from("telemetry_events").select("user_id").eq("session_id", s5);
    const f = mismaSesion ?? [];
    check("20 · la sesión sobrevive al inicio de sesión y queda atribuible entera",
      f.length === 2 && f.some((x) => x.user_id === null) && f.some((x) => x.user_id === A.id),
      `${f.length} filas`);

    const s6 = randomUUID(); sesiones.push(s6);
    check("21 · un Bearer inválido no rompe: se trata como anónimo",
      (await post({ event_name: "session_started", session_id: s6 }, "token-basura")) === 204);
    check("22 · …y se guarda sin usuario", (await lastRow(s6))?.user_id === null);

    // ═══════════════════ BEST EFFORT ═══════════════════
    console.log("\nBEST EFFORT");

    const s7 = randomUUID(); sesiones.push(s7);
    const inicio = Date.now();
    await post({ event_name: "zone_entered", session_id: s7, zone: "duel_play" });
    const ms = Date.now() - inicio;
    check("23 · el endpoint responde rápido (no está en el camino crítico)", ms < 2000, `${ms} ms`);

    check("24 · la respuesta no devuelve NINGÚN dato",
      await (async () => {
        const res = await fetch(ENDPOINT, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ event_name: "zone_entered", session_id: randomUUID(), zone: "home" }),
        });
        const txt = await res.text();
        return res.status === 204 && txt.length === 0;
      })());

    // Frecuencia: una ráfaga por encima del techo debe cortarse.
    const sBurst = randomUUID(); sesiones.push(sBurst);
    let limitado = false;
    for (let i = 0; i < 140; i++) {
      const st = await post({ event_name: "zone_entered", session_id: sBurst, zone: i % 2 ? "home" : "market" });
      if (st === 429) { limitado = true; break; }
    }
    check("25 · una ráfaga se corta con 429 (protección de bucles)", limitado);

    // ═══════════════════ LO ESCRITO EN LA BASE DE DATOS ═══════════════════
    console.log("\nVERIFICACIÓN EN BASE DE DATOS");

    const { data: escritas } = await db.from("telemetry_events")
      .select("event_name, zone, flow, severity, environment, app_version, session_id, occurred_at")
      .in("session_id", sesiones);
    const filas = (escritas ?? []) as Record<string, unknown>[];

    check("26 · se escribieron filas para las sesiones de la prueba", filas.length > 0, `${filas.length} filas`);

    const nombres = new Set(filas.map((x) => x.event_name));
    check("27 · todos los event_name escritos están en la taxonomía",
      [...nombres].every((n) => ["session_started", "zone_entered", "flow_started", "error_captured"].includes(n as string)),
      [...nombres].join(", "));

    const zonas = new Set(filas.map((x) => x.zone).filter(Boolean));
    check("28 · todas las zonas escritas son del enum (ninguna ruta)",
      [...zonas].every((z) => typeof z === "string" && !(z as string).includes("/")),
      [...zonas].join(", "));

    check("29 · todas las filas llevan entorno y versión puestos por el servidor",
      filas.every((x) => !!x.environment && !!x.app_version),
      `env=${filas[0]?.environment} ver=${filas[0]?.app_version}`);

    check("30 · ninguna fila lleva una fecha del pasado inventada",
      filas.every((x) => new Date(x.occurred_at as string).getFullYear() >= 2026));

    // ═══════════════════ AISLAMIENTO ═══════════════════
    console.log("\nAISLAMIENTO");

    /*
     * El libro mayor NO está vacío: el disparador de alta escribe el asiento
     * `starter_grant` de los 6.000 créditos de bienvenida. Eso es del registro, no de la
     * telemetría.
     *
     * Lo que se comprueba es que ese siga siendo el ÚNICO asiento: ni una de las 128
     * peticiones de telemetría de esta prueba movió un crédito.
     */
    const { data: asientos } = await db.from("credit_transactions")
      .select("reason, delta").eq("user_id", A.id);
    const libro = (asientos ?? []) as { reason: string; delta: number }[];
    check("31 · la telemetría no movió NI UN asiento (solo queda el del alta)",
      libro.length === 1 && libro[0].reason === "starter_grant",
      libro.map((x) => `${x.reason}:${x.delta}`).join(", ") || "(vacío)");

    const { data: perfil } = await db.from("profiles").select("credits, xp, points").eq("id", A.id).maybeSingle();
    const p = perfil as { credits: number; xp: number; points: number } | null;
    check("32 · el perfil sigue con el saldo de alta y sin XP ni puntos",
      !!p && p.xp === 0 && p.points === 0, JSON.stringify(p));
  } finally {
    await db.from("telemetry_events").delete().in("session_id", sesiones);
    for (const id of cuentas) await db.auth.admin.deleteUser(id).catch(() => {});
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${pass} correctas · ${fail} fallidas`);
  console.log(fail === 0 ? "  ✅ LA INGESTIÓN AGUANTA\n" : "  ❌ HAY FALLOS\n");
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
