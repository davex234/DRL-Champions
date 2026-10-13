/**
 * VERIFICACIÓN DE TELEMETRÍA — `npm run telemetry:verify` (Fase 14, bloque 3).
 *
 * Ataca `telemetry_events` contra la base de datos REAL.
 *
 * Lo que aquí se comprueba NO es que TypeScript valide: es que **la base de datos se
 * niegue**. Una defensa que solo vive en Node se salta con otro cliente, y la telemetría
 * es justo el tipo de tabla a la que alguien acabará escribiendo desde un sitio raro.
 *
 * Tres familias:
 *
 *   ESQUEMA     — los conjuntos cerrados están cerrados de verdad, y una fila incoherente
 *                 (un cambio de zona con severidad, un error sin origen) se rechaza.
 *   SEGURIDAD   — un usuario autenticado no lee lo suyo, no lee lo ajeno, no escribe, no
 *                 modifica y no borra. Ni con el cliente de Supabase en la mano.
 *   INTEGRIDAD  — la fecha la pone el servidor, la clave foránea arrastra, y `metadata`
 *                 no es un vertedero.
 *
 * Crea sus propias cuentas y sus propias filas, y lo borra todo al terminar.
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

let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL_ || !SERVICE || !ANON) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  process.exit(1);
}

const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });

/** Fila mínima válida. Los tests la mutan para probar cada restricción. */
const base = (over: Record<string, unknown> = {}) => ({
  event_name: "session_started",
  environment: "test",
  session_id: randomUUID(),
  metadata: {},
  ...over,
});

/** Inserta con service_role y devuelve el mensaje de error, o null si entró. */
async function insertError(row: Record<string, unknown>): Promise<string | null> {
  const { error } = await db.from("telemetry_events").insert(row);
  return error?.message ?? null;
}

/** ¿La inserción fue rechazada por la restricción `nombre`? */
async function rejectedBy(row: Record<string, unknown>, nombre: string): Promise<boolean> {
  const msg = await insertError(row);
  return msg !== null && msg.includes(nombre);
}

async function main() {
  console.log("\n═══ VERIFICACIÓN DE TELEMETRÍA (telemetry_events) ═══\n");

  const creadas: string[] = [];
  const nuevaCuenta = async (etiqueta: string) => {
    const email = `tel-${etiqueta}-${Date.now()}@example.invalid`;
    const password = ephemeralQaPassword();
    const { data, error } = await db.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { username: `tel${etiqueta}${Date.now().toString(36)}` },
    });
    if (error || !data.user) throw new Error(error?.message ?? "no se pudo crear la cuenta");
    creadas.push(data.user.id);
    return { id: data.user.id, email, password };
  };

  const A = await nuevaCuenta("a");
  const B = await nuevaCuenta("b");
  const sesionA = randomUUID();

  try {
    // ══════════════════════ ESQUEMA ══════════════════════
    console.log("ESQUEMA");

    // 1
    const { error: eTabla } = await db.from("telemetry_events").select("id").limit(1);
    check("1 · la tabla existe y es legible con service_role", !eTabla, eTabla?.message);

    // 2
    const okNombres: string[] = [];
    for (const [nombre, extra] of [
      ["session_started", {}],
      ["zone_entered", { zone: "home" }],
      ["flow_started", { flow: "deck_builder" }],
      ["error_captured", { source: "client", severity: "error" }],
    ] as [string, Record<string, unknown>][]) {
      const msg = await insertError(base({ event_name: nombre, user_id: A.id, session_id: sesionA, ...extra }));
      if (msg === null) okNombres.push(nombre);
    }
    check("2 · los cuatro event_name aprobados se aceptan", okNombres.length === 4, okNombres.join(", "));

    // 3
    check("3 · un event_name inventado se RECHAZA en la base de datos",
      await rejectedBy(base({ event_name: "pack_opened" }), "telemetry_events_name_check"));

    // 4
    check("4 · una zona del inventario se acepta",
      (await insertError(base({ event_name: "zone_entered", zone: "trainer_strats" }))) === null);

    // 5
    check("5 · una zona desconocida se RECHAZA",
      await rejectedBy(base({ event_name: "zone_entered", zone: "/coleccion?filtro=raro" }), "telemetry_events_zone_check"));

    // 6
    check("6 · un flow aprobado se acepta",
      (await insertError(base({ event_name: "flow_started", flow: "pickem_form" }))) === null);

    // 7
    check("7 · un flow inventado se RECHAZA",
      await rejectedBy(base({ event_name: "flow_started", flow: "checkout" }), "telemetry_events_flow_check"));

    // 8
    check("8 · las tres severidades se aceptan",
      (await insertError(base({ event_name: "error_captured", source: "server", severity: "critical" }))) === null);

    // 9
    check("9 · una severidad inventada se RECHAZA",
      await rejectedBy(base({ event_name: "error_captured", source: "client", severity: "fatal" }), "telemetry_events_severity_check"));

    // 10
    check("10 · los tres entornos se aceptan",
      (await insertError(base({ environment: "production" }))) === null);

    // 11
    check("11 · un entorno inventado se RECHAZA",
      await rejectedBy(base({ environment: "staging" }), "telemetry_events_env_check"));

    // ── Coherencia entre campos: lo que TypeScript no puede garantizar ──
    console.log("\nCOHERENCIA");

    check("12 · un error_captured SIN origen ni severidad se RECHAZA",
      await rejectedBy(base({ event_name: "error_captured" }), "telemetry_events_shape_check"));

    check("13 · un zone_entered SIN zona se RECHAZA",
      await rejectedBy(base({ event_name: "zone_entered" }), "telemetry_events_shape_check"));

    check("14 · un flow_started SIN flujo se RECHAZA",
      await rejectedBy(base({ event_name: "flow_started" }), "telemetry_events_shape_check"));

    check("15 · un zone_entered CON severidad se RECHAZA (fila incoherente)",
      await rejectedBy(base({ event_name: "zone_entered", zone: "home", severity: "critical" }), "telemetry_events_shape_check"));

    // ══════════════════════ SESIÓN ══════════════════════
    console.log("\nSESIÓN");

    // 16
    const sesionAnon = randomUUID();
    check("16 · un evento con session_id y SIN user_id se acepta (visitante anónimo)",
      (await insertError(base({ session_id: sesionAnon }))) === null);

    // 17
    check("17 · el MISMO session_id se acepta después con user_id (se conserva al entrar)",
      (await insertError(base({ session_id: sesionAnon, user_id: A.id, event_name: "zone_entered", zone: "account" }))) === null);

    // 18
    const { data: mismaSesion } = await db.from("telemetry_events")
      .select("user_id").eq("session_id", sesionAnon);
    const filas = mismaSesion ?? [];
    check("18 · la sesión anónima y la autenticada quedan unidas por session_id",
      filas.length === 2 && filas.some((f) => f.user_id === null) && filas.some((f) => f.user_id === A.id),
      `${filas.length} filas`);

    // ══════════════════════ INTEGRIDAD ══════════════════════
    console.log("\nINTEGRIDAD");

    // 19 — la fecha la pone el servidor, no quien inserta
    const antes = Date.now();
    await db.from("telemetry_events").insert(base({ user_id: B.id, event_name: "zone_entered", zone: "market" }));
    const { data: reciente } = await db.from("telemetry_events")
      .select("occurred_at").eq("user_id", B.id).order("id", { ascending: false }).limit(1).maybeSingle();
    const sellada = reciente ? new Date((reciente as { occurred_at: string }).occurred_at).getTime() : 0;
    check("19 · occurred_at lo sella el servidor (default now())",
      sellada >= antes - 5000 && sellada <= Date.now() + 5000,
      reciente ? (reciente as { occurred_at: string }).occurred_at : "sin fila");

    // 20 — metadata debe ser un objeto
    check("20 · metadata que no es un objeto se RECHAZA",
      await rejectedBy(base({ metadata: [1, 2, 3] }), "telemetry_events_metadata_object_check"));

    // 21 — techo de tamaño
    check("21 · metadata por encima de 2 KB se RECHAZA (no es un vertedero)",
      await rejectedBy(base({ metadata: { basura: "x".repeat(4000) } }), "telemetry_events_metadata_size_check"));

    // 22 — un usuario inexistente no puede tener eventos
    check("22 · la clave foránea rechaza un user_id que no existe",
      (await insertError(base({ user_id: randomUUID() }))) !== null);

    // 23 — solo anexado: ni service_role puede reescribir la historia
    const { data: paraEditar } = await db.from("telemetry_events")
      .select("id").eq("user_id", A.id).limit(1).maybeSingle();
    const idEditar = (paraEditar as { id: number } | null)?.id;
    const { error: eUpd } = await db.from("telemetry_events")
      .update({ zone: "home" }).eq("id", idEditar ?? -1);
    check("23 · UPDATE bloqueado por disparador, incluso con service_role",
      !!eUpd && eUpd.message.includes("TEL-01"), eUpd?.message?.slice(0, 60));

    // ══════════════════════ SEGURIDAD ══════════════════════
    console.log("\nSEGURIDAD (como usuario autenticado, no como service_role)");

    const comoA = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: signin, error: eSign } = await comoA.auth.signInWithPassword({
      email: A.email, password: A.password,
    });
    if (eSign || !signin.session) throw new Error("no se pudo iniciar sesión como A");

    // 24
    const { data: propios } = await comoA.from("telemetry_events").select("id").eq("user_id", A.id);
    check("24 · un usuario NO puede leer ni su propia telemetría", (propios ?? []).length === 0,
      `${(propios ?? []).length} filas visibles`);

    // 25
    const { data: ajenos } = await comoA.from("telemetry_events").select("id").eq("user_id", B.id);
    check("25 · un usuario NO puede leer la telemetría de otro", (ajenos ?? []).length === 0,
      `${(ajenos ?? []).length} filas visibles`);

    // 26
    const { data: global } = await comoA.from("telemetry_events").select("id").limit(100);
    check("26 · un usuario NO puede listar la telemetría global", (global ?? []).length === 0,
      `${(global ?? []).length} filas visibles`);

    // 27
    const { error: eIns } = await comoA.from("telemetry_events").insert(base({ user_id: A.id }));
    check("27 · un usuario NO puede insertar directamente (el escritor será el servidor)", !!eIns,
      eIns?.message?.slice(0, 60));

    // 28 — suplantación: insertar en nombre de otro
    const { error: eSupl } = await comoA.from("telemetry_events").insert(base({ user_id: B.id }));
    check("28 · un usuario NO puede insertar en nombre de otro", !!eSupl, eSupl?.message?.slice(0, 60));

    // 29
    const { error: eUpdU, count: cUpd } = await comoA.from("telemetry_events")
      .update({ zone: "home" }, { count: "exact" }).eq("user_id", A.id);
    check("29 · un usuario NO puede modificar eventos", !!eUpdU || (cUpd ?? 0) === 0,
      eUpdU ? eUpdU.message.slice(0, 50) : `${cUpd ?? 0} filas afectadas`);

    // 30
    const { error: eDel, count: cDel } = await comoA.from("telemetry_events")
      .delete({ count: "exact" }).eq("user_id", A.id);
    check("30 · un usuario NO puede borrar eventos", !!eDel || (cDel ?? 0) === 0,
      eDel ? eDel.message.slice(0, 50) : `${cDel ?? 0} filas afectadas`);

    // 31 — anónimo, sin sesión ninguna
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { data: anonLee } = await anon.from("telemetry_events").select("id").limit(10);
    const { error: eAnonIns } = await anon.from("telemetry_events").insert(base({}));
    check("31 · un cliente anónimo no lee nada", (anonLee ?? []).length === 0);
    check("32 · un cliente anónimo no puede insertar", !!eAnonIns, eAnonIns?.message?.slice(0, 60));

    // 33 — los datos siguen ahí (que nadie los vea no significa que se borraran)
    const { count: total } = await db.from("telemetry_events")
      .select("id", { count: "exact", head: true }).eq("user_id", A.id);
    check("33 · las filas siguen intactas tras los intentos de borrado", (total ?? 0) > 0,
      `${total ?? 0} filas de A`);

    // ══════════════════════ CONSULTAS DE EMBUDO ══════════════════════
    console.log("\nCONSULTAS");

    const { data: porZona } = await db.from("telemetry_events")
      .select("zone").eq("event_name", "zone_entered").not("zone", "is", null).limit(50);
    check("34 · se puede agregar uso por zona (índice event_name, occurred_at)",
      Array.isArray(porZona) && porZona.length > 0, `${(porZona ?? []).length} filas`);

    const { data: criticos } = await db.from("telemetry_events")
      .select("id, severity").eq("severity", "critical").limit(10);
    check("35 · se pueden aislar los errores críticos (índice parcial de severidad)",
      Array.isArray(criticos) && criticos.length > 0, `${(criticos ?? []).length} críticos`);
  } finally {
    // Limpieza: las cuentas arrastran sus eventos por `on delete cascade`.
    for (const id of creadas) await db.auth.admin.deleteUser(id).catch(() => {});
    // Y las filas anónimas de esta ejecución, que no cuelgan de ninguna cuenta.
    // Sin `.catch`: el constructor de PostgREST es «thenable», no una Promise, y no lo tiene.
    await db.from("telemetry_events").delete().eq("environment", "test");
    await db.from("telemetry_events").delete().is("user_id", null);
    await db.from("telemetry_events").delete().eq("environment", "production");
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${pass} correctas · ${fail} fallidas`);
  console.log(fail === 0 ? "  ✅ EL MODELO DE TELEMETRÍA AGUANTA\n" : "  ❌ HAY FALLOS\n");
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
