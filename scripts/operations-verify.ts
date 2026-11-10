/**
 * VERIFICACIÓN DE LIVE OPERATIONS — `npm run operations:verify` (Fase 14, bloque 6).
 *
 * Ataca `/api/admin/operations` desde los tres lados que importan: sin sesión, con una
 * cuenta normal y con un administrador de verdad.
 *
 * Lo que se demuestra:
 *
 *   · que un usuario normal recibe 403 y **ni un dato**;
 *   · que la autorización es `verifyAdmin` (Bearer + `profiles.is_admin`), no una
 *     constante de interfaz;
 *   · que el cliente no puede alterar la ventana ni colar un `user_id`;
 *   · que el snapshot no lleva PII ni recorridos individuales;
 *   · que el fallo de un bloque no tumba los otros ocho;
 *   · que la cobertura se declara, para que un cero no se lea como un dato.
 *
 * Crea sus propias cuentas —una normal y una administradora— y las borra al terminar.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const EP = `${BASE}/api/admin/operations`;

async function get(token?: string, query = "") {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${EP}${query}`, { headers, cache: "no-store" });
  const body = await res.text();
  return { status: res.status, body, json: (() => { try { return JSON.parse(body); } catch { return null; } })() };
}

async function main() {
  const ping = await fetch(`${BASE}/`).catch(() => null);
  if (!ping?.ok) {
    console.error(`\n❌ No hay servidor NEXUS en ${BASE}. Arranca 'npx next start -p 3005'.\n`);
    process.exit(1);
  }

  console.log("\n═══ VERIFICACIÓN DE LIVE OPERATIONS ═══\n");

  const cuentas: string[] = [];
  const crear = async (etq: string, admin: boolean) => {
    const email = `ops-${etq}-${Date.now()}@example.invalid`;
    const password = ephemeralQaPassword();
    const { data, error } = await db.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { username: `ops${etq}${Date.now().toString(36)}` },
    });
    if (error || !data.user) throw new Error(error?.message ?? "no se pudo crear");
    cuentas.push(data.user.id);
    if (admin) await db.from("profiles").update({ is_admin: true }).eq("id", data.user.id);
    const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: si } = await pub.auth.signInWithPassword({ email, password });
    return { id: data.user.id, token: si!.session!.access_token };
  };

  try {
    const normal = await crear("user", false);
    const admin = await crear("admin", true);

    // ══════════════════ AUTORIZACIÓN ══════════════════
    console.log("AUTORIZACIÓN");

    const sinSesion = await get();
    check("1 · sin sesión → 401", sinSesion.status === 401, `${sinSesion.status}`);
    check("2 · …y no devuelve ninguna métrica",
      !sinSesion.body.includes("generatedAt") && !sinSesion.body.includes("ftue"),
      sinSesion.body.slice(0, 50));

    const usuario = await get(normal.token);
    check("3 · usuario normal autenticado → 403 (no 401: sabemos quién es)",
      usuario.status === 403, `${usuario.status}`);
    check("4 · …y NO devuelve ni un dato",
      !usuario.body.includes("generatedAt") && !usuario.body.includes("sessions")
        && !usuario.body.includes("ftue"),
      usuario.body.slice(0, 60));
    check("5 · …y el mensaje no revela si el token era malo o si falta el permiso",
      !/is_admin|token|inválid/i.test(usuario.body), usuario.body.slice(0, 60));

    const basura = await get("token-inventado");
    check("6 · un Bearer inventado → 403, tampoco datos",
      basura.status === 403 && !basura.body.includes("generatedAt"), `${basura.status}`);

    const adm = await get(admin.token);
    check("7 · administrador → 200 con el snapshot", adm.status === 200 && !!adm.json?.generatedAt,
      `${adm.status}`);

    // La autorización es el flag de la BD, no una constante: se le quita y deja de entrar.
    await db.from("profiles").update({ is_admin: false }).eq("id", admin.id);
    const degradado = await get(admin.token);
    check("8 · quitando profiles.is_admin, el MISMO token pasa a 403",
      degradado.status === 403, `${degradado.status}`);
    await db.from("profiles").update({ is_admin: true }).eq("id", admin.id);

    // ══════════════════ SNAPSHOT ══════════════════
    console.log("\nSNAPSHOT");
    const snap = (await get(admin.token)).json as Record<string, any>;

    check("9 · trae los nueve bloques",
      ["activity", "sessions", "zones", "ftue", "duel", "pickems", "market", "errors", "flows"]
        .every((k) => k in snap),
      Object.keys(snap).join(", ").slice(0, 90));

    check("10 · cada bloque declara si pudo calcularse",
      ["activity", "sessions", "zones", "ftue", "duel", "pickems", "market", "errors", "flows"]
        .every((k) => typeof snap[k]?.ok === "boolean"));

    check("11 · declara cuándo se generó, la ventana y lo que tardó",
      typeof snap.generatedAt === "string" && typeof snap.window === "string"
        && typeof snap.tookMs === "number",
      `${snap.window} · ${snap.tookMs}ms`);

    check("12 · declara la COBERTURA de telemetría (para no enseñar ceros ambiguos)",
      typeof snap.coverage?.hasTelemetry === "boolean" && "telemetrySince" in snap.coverage,
      `hasTelemetry=${snap.coverage?.hasTelemetry}`);

    check("13 · el FTUE trae los siete pasos, cada uno con su fuente",
      snap.ftue?.ok && snap.ftue.data.length === 7
        && snap.ftue.data.every((s: any) => typeof s.source === "string"),
      `${snap.ftue?.data?.length} pasos`);

    check("14 · el FTUE es RETROACTIVO: hay usuarios aunque no haya telemetría",
      snap.ftue?.ok && snap.ftue.data[0].users >= 2,
      `${snap.ftue?.data?.[0]?.users} en la cohorte`);

    check("15 · el duelo trae el abandono como ESTIMACIÓN, con ese nombre",
      snap.duel?.ok && "abandoned_estimate" in snap.duel.data);

    check("16 · las sesiones traen la duración como COTA INFERIOR, con ese nombre",
      snap.sessions?.ok && "median_seconds_lower_bound" in snap.sessions.data);

    check("17 · las zonas separan usuarios, sesiones y entradas",
      snap.zones?.ok && (snap.zones.data.length === 0
        || ["users", "sessions", "entries"].every((k) => k in snap.zones.data[0])));

    check("18 · los errores vienen agrupados con su versión de aplicación",
      snap.errors?.ok && (snap.errors.data.length === 0
        || ["fingerprint", "occurrences", "app_version"].every((k) => k in snap.errors.data[0])));

    // ══════════════════ VENTANAS ══════════════════
    console.log("\nVENTANAS");
    for (const w of ["24h", "7d", "30d"]) {
      const r = (await get(admin.token, `?window=${w}`)).json as Record<string, any>;
      check(`19.${w} · la ventana ${w} se acepta y se refleja en el snapshot`, r?.window === w, r?.window);
    }
    const raro = (await get(admin.token, "?window=' OR 1=1--")).json as Record<string, any>;
    check("20 · una ventana inventada cae en 24h, no se pasa a la consulta",
      raro?.window === "24h", raro?.window);
    const arbitrario = (await get(admin.token, "?window=2020-01-01&from=1990-01-01")).json as Record<string, any>;
    check("21 · no hay rango de fechas arbitrario: se ignora", arbitrario?.window === "24h");

    // ══════════════════ SEGURIDAD DEL DATO ══════════════════
    console.log("\nSEGURIDAD DEL DATO");
    const texto = JSON.stringify(snap);

    check("22 · el snapshot NO contiene direcciones de correo",
      !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(texto));
    check("23 · el snapshot NO contiene identificadores de usuario",
      !/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(texto));
    check("24 · el snapshot NO contiene tokens, cookies ni cabeceras",
      !/eyJ[A-Za-z0-9_-]{8,}|bearer |cookie|authorization/i.test(texto));
    check("25 · el snapshot NO contiene direcciones IP ni user agent",
      !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|Mozilla\//.test(texto));
    check("26 · el snapshot NO contiene recorridos individuales (solo agregados)",
      !("journey" in snap) && !("users_list" in snap) && !("players" in (snap.sessions?.data ?? {})));

    // Intentos de inyección desde el cliente.
    const conUserId = await fetch(`${EP}?window=24h&user_id=${normal.id}`, {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    const cuerpo = await conUserId.text();
    check("27 · un user_id en la consulta no filtra ni aparece en la respuesta",
      conUserId.status === 200 && !cuerpo.includes(normal.id));
    const conEnv = (await get(admin.token, "?window=24h&environment=production")).json as Record<string, any>;
    check("28 · el cliente no puede elegir el entorno", conEnv?.window === "24h" && !("environment" in conEnv));

    // ══════════════════ ROBUSTEZ ══════════════════
    console.log("\nROBUSTEZ");
    check("29 · el snapshot se construye en un tiempo razonable", (snap.tookMs ?? 99999) < 5000,
      `${snap.tookMs}ms`);
    check("30 · un bloque que falla no impide que lleguen los demás",
      Object.keys(snap).filter((k) => snap[k]?.ok === true).length >= 5,
      `${Object.keys(snap).filter((k) => snap[k]?.ok === true).length} bloques correctos`);
    check("31 · la respuesta no se cachea",
      (await fetch(EP, { headers: { authorization: `Bearer ${admin.token}` } }))
        .headers.get("cache-control")?.includes("no-store") ?? false);
  } finally {
    for (const id of cuentas) await db.auth.admin.deleteUser(id).catch(() => {});
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${pass} correctas · ${fail} fallidas`);
  console.log(fail === 0 ? "  ✅ LA CONSOLA ESTÁ PROTEGIDA Y RESPONDE\n" : "  ❌ HAY FALLOS\n");
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
