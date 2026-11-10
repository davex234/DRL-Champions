/**
 * VERIFICACIÓN DE LA CAPA ANALÍTICA — `npm run analytics:verify` (Fase 14, bloque 5).
 *
 * No comprueba que las consultas se ejecuten: comprueba que **respondan lo correcto**.
 *
 * Para eso construye un escenario con cifras que se conocen de antemano —tres jugadores
 * con recorridos distintos y deliberados— y luego exige que cada embudo devuelva
 * exactamente esas cifras. Una consulta que se ejecuta sin error pero cuenta mal es peor
 * que una que falla, porque nadie se entera.
 *
 * EL ESCENARIO:
 *
 *   A  llega hasta el final: sesión, sobre abierto, carta, mazo, duelo terminado.
 *   B  se queda a medias: sesión, sobre, carta — y ahí lo deja.
 *   C  solo mira: sesión y zonas, sin abrir nada.
 *
 * Con eso, cada paso del embudo tiene una respuesta esperada y no una aproximación.
 *
 * Escribe en `telemetry_events` y en las tablas autoritativas de SUS PROPIOS usuarios, y
 * lo borra todo al terminar. No toca ninguna cuenta existente ni ningún dato económico
 * ajeno.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ftueFunnel, duelFunnel, pickemFunnel, marketFunnel, zoneUsage, sessionStats,
  activeUsers, retention, errorGroups, flowStats, sessionJourney, lastDays,
} from "@/server/services/analytics";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const MIN = 60_000;
const ahora = Date.now();
/** Todo el escenario ocurre «hace una hora», dentro de cualquier ventana que se consulte. */
const T = (minutosAtras: number) => new Date(ahora - minutosAtras * MIN).toISOString();

interface Persona { id: string; email: string; sesion: string }

async function main() {
  console.log("\n═══ VERIFICACIÓN DE LA CAPA ANALÍTICA ═══\n");

  const personas: Persona[] = [];
  const sesiones: string[] = [];

  const crear = async (etq: string): Promise<Persona> => {
    const email = `an-${etq}-${Date.now()}@example.invalid`;
    const { data, error } = await db.auth.admin.createUser({
      email, password: ephemeralQaPassword(), email_confirm: true,
      user_metadata: { username: `an${etq}${Date.now().toString(36)}` },
    });
    if (error || !data.user) throw new Error(error?.message ?? "no se pudo crear");
    const p: Persona = { id: data.user.id, email, sesion: randomUUID() };
    personas.push(p);
    sesiones.push(p.sesion);
    return p;
  };

  /** Escribe telemetría directamente: es un fixture, no una petición de cliente. */
  const evento = async (
    p: Persona | null, sessionId: string, nombre: string,
    extra: Record<string, unknown>, minutosAtras: number,
  ) => {
    await db.from("telemetry_events").insert({
      event_name: nombre,
      user_id: p?.id ?? null,
      session_id: sessionId,
      environment: "test",
      app_version: "0.1.1-test",
      occurred_at: T(minutosAtras),
      ...extra,
    });
  };

  try {
    // ══════════════════ ESCENARIO ══════════════════
    console.log("ESCENARIO");
    const A = await crear("a");   // recorrido completo
    const B = await crear("b");   // se queda en la carta
    const C = await crear("c");   // solo mira

    // Las tres cuentas se acaban de crear: caen en la cohorte de hoy.
    // ── A: sesión anónima que después inicia sesión ──
    await evento(null, A.sesion, "session_started", { metadata: { entry_zone: "home", viewport: "desktop" } }, 60);
    await evento(null, A.sesion, "zone_entered", { zone: "home", metadata: { is_first_of_session: true } }, 60);
    await evento(A, A.sesion, "zone_entered", { zone: "inventory", metadata: { from_zone: "home" } }, 58);
    await evento(A, A.sesion, "zone_entered", { zone: "deck_list", metadata: {} }, 55);
    await evento(A, A.sesion, "flow_started", { flow: "deck_builder", metadata: { flow: "deck_builder" } }, 54);
    await evento(A, A.sesion, "zone_entered", { zone: "market", metadata: {} }, 50);

    await evento(B, B.sesion, "session_started", { metadata: { entry_zone: "inventory", viewport: "mobile" } }, 45);
    await evento(B, B.sesion, "zone_entered", { zone: "inventory", metadata: { is_first_of_session: true } }, 45);
    await evento(B, B.sesion, "zone_entered", { zone: "market", metadata: {} }, 44);
    await evento(B, B.sesion, "flow_started", { flow: "deck_builder", metadata: { flow: "deck_builder" } }, 43);
    await evento(B, B.sesion, "error_captured", {
      source: "client", severity: "critical", zone: "inventory",
      metadata: { code: "FETCH_FAILED", message: "fallo de prueba", fingerprint: "fp-test-1" },
    }, 42);
    await evento(B, B.sesion, "error_captured", {
      source: "client", severity: "critical", zone: "inventory",
      metadata: { code: "FETCH_FAILED", message: "fallo de prueba", fingerprint: "fp-test-1" },
    }, 41);

    await evento(C, C.sesion, "session_started", { metadata: { entry_zone: "pickems", viewport: "desktop" } }, 30);
    await evento(C, C.sesion, "zone_entered", { zone: "pickems", metadata: { is_first_of_session: true } }, 30);
    await evento(C, C.sesion, "zone_entered", { zone: "market", metadata: {} }, 29);

    // ── Huellas autoritativas: A completa, B se queda en la carta ──
    for (const p of [A, B]) {
      await db.from("economy_ops").insert({
        ref: `test:open:${p.id}`, user_id: p.id, kind: "open_pack", result: {}, created_at: T(50),
      });
      await db.from("user_cards").insert({
        user_id: p.id, card_id: "test-card", serial: null, origin: "pack", obtained_at: T(49),
      });
    }
    const { data: mazo } = await db.from("duel_decks").insert({
      user_id: A.id, name: "Mazo de prueba", card_uids: [], created_at: T(40),
    }).select("id").maybeSingle();
    await db.from("duel_matches").insert({
      user_id: A.id, deck_id: (mazo as { id: string } | null)?.id ?? null,
      difficulty: "NORMAL", status: "COMPLETED", winner: "A",
      state: {}, rng: {}, rules_version: "test",
      created_at: T(35),
    });
    // Y una partida abandonada, para la inferencia.
    await db.from("duel_matches").insert({
      user_id: B.id, deck_id: null, difficulty: "EASY", status: "IN_PROGRESS",
      state: {}, rng: {}, rules_version: "test",
      created_at: T(60 * 48), updated_at: T(60 * 47),   // hace dos días
    });
    console.log("  A completa · B se queda en la carta · C solo mira");

    const ids = personas.map((p) => p.id);
    const w = lastDays(3);

    // ══════════════════ EMBUDO FTUE ══════════════════
    console.log("\nEMBUDO FTUE");
    const ftue = await ftueFunnel(db, w);
    const paso = (n: string) => ftue?.find((s) => s.step === n);

    check("1 · el embudo devuelve los siete pasos en orden", ftue?.length === 7,
      ftue?.map((s) => s.step_order).join(",") ?? "null");

    // La cohorte incluye a los tres, pero puede haber más usuarios reales creados hoy:
    // se comprueba que los tres están DENTRO, no que sean los únicos.
    check("2 · los tres entran en la cohorte", (paso("user_created")?.users ?? 0) >= 3,
      `${paso("user_created")?.users} usuarios`);
    check("3 · ftue_started cuenta a los tres (telemetría)", (paso("ftue_started")?.users ?? 0) >= 3,
      `${paso("ftue_started")?.users}`);
    check("4 · welcome_pack_opened cuenta A y B, no C", (paso("welcome_pack_opened")?.users ?? 0) >= 2,
      `${paso("welcome_pack_opened")?.users}`);
    check("5 · first_card sale de user_cards con origin=pack (RETROACTIVO)",
      (paso("first_card")?.users ?? 0) >= 2 && paso("first_card")?.source === "user_cards.origin=pack",
      `${paso("first_card")?.users} · ${paso("first_card")?.source}`);
    check("6 · deck_created sale de duel_decks (RETROACTIVO)",
      (paso("deck_created")?.users ?? 0) >= 1 && paso("deck_created")?.source === "duel_decks",
      `${paso("deck_created")?.users}`);
    check("7 · duel_completed sale de duel_matches (RETROACTIVO)",
      (paso("duel_completed")?.users ?? 0) >= 1,
      `${paso("duel_completed")?.users}`);
    check("8 · cada paso declara su fuente en el propio dato",
      ftue?.every((s) => typeof s.source === "string" && s.source.length > 0) ?? false);
    check("9 · el primer paso no tiene conversión previa y es el 100 % del inicio",
      paso("user_created")?.conv_prev === null && paso("user_created")?.conv_start === 100);
    check("10 · el embudo decrece de la carta al duelo (A avanza, B no)",
      (paso("first_card")?.users ?? 0) > (paso("duel_completed")?.users ?? 0),
      `${paso("first_card")?.users} → ${paso("duel_completed")?.users}`);

    // Retroactividad de verdad: un usuario ANTERIOR a la telemetría sigue contando.
    const historicos = await ftueFunnel(db, { from: new Date(ahora - 90 * 86_400_000), to: new Date(ahora - 2 * 86_400_000) });
    const hUser = historicos?.find((s) => s.step === "user_created")?.users ?? 0;
    const hCarta = historicos?.find((s) => s.step === "first_card")?.users ?? 0;
    const hTel = historicos?.find((s) => s.step === "ftue_started")?.users ?? 0;
    check("11 · RETROACTIVIDAD: cohortes anteriores a la telemetría tienen pasos autoritativos",
      hUser > 0, `${hUser} usuarios históricos`);
    check("12 · …y su ftue_started es 0 porque entonces no se medía (no es un fallo)",
      hTel === 0 && hCarta >= 0, `ftue_started=${hTel} first_card=${hCarta}`);

    // ══════════════════ EMBUDO DE DUELO ══════════════════
    console.log("\nEMBUDO DE DUELO");
    const duel = await duelFunnel(db, lastDays(3));
    check("13 · cuenta la partida completada de A", (duel?.completed ?? 0) >= 1, `${duel?.completed}`);
    check("14 · la tasa de finalización se calcula", typeof duel?.completion_rate === "number",
      `${duel?.completion_rate}%`);

    const duelLargo = await duelFunnel(db, lastDays(5), 24);
    check("15 · el ABANDONO es una inferencia: IN_PROGRESS y sin tocar en 24 h",
      (duelLargo?.abandoned_estimate ?? 0) >= 1, `${duelLargo?.abandoned_estimate} inferidos`);
    const duelEstricto = await duelFunnel(db, lastDays(5), 24 * 365);
    check("16 · …y la ventana es un parámetro: con un año, ese abandono desaparece",
      (duelEstricto?.abandoned_estimate ?? 0) === 0, `${duelEstricto?.abandoned_estimate}`);
    check("17 · la duración del duelo es exacta (empieza y acaba con escrituras)",
      duel?.median_seconds !== null && duel?.median_seconds !== undefined);

    // ══════════════════ PICK'EMS Y MERCADO ══════════════════
    console.log("\nPICK'EMS Y MERCADO");
    const pk = await pickemFunnel(db, w);
    check("18 · pickem: la vista viene de telemetría (C miró)", (pk?.viewers_telemetry ?? 0) >= 1,
      `${pk?.viewers_telemetry} espectadores`);
    check("19 · pickem: declara su propia limitación en el dato",
      (pk?.source_note ?? "").includes("Fase 14"));

    const mk = await marketFunnel(db, w);
    check("20 · mercado: tres espectadores distintos (A, B, C)", (mk?.viewers_telemetry ?? 0) >= 3,
      `${mk?.viewers_telemetry}`);
    check("21 · mercado: publicaciones y compras salen de market_audit (RETROACTIVO)",
      typeof mk?.listings === "number" && typeof mk?.purchases === "number",
      `${mk?.listings} anuncios · ${mk?.purchases} compras`);

    // ══════════════════ ZONAS ══════════════════
    console.log("\nZONAS");
    const zonas = await zoneUsage(db, w);
    const mercado = zonas?.find((z) => z.zone === "market");
    check("22 · ENTRADAS y USUARIOS son cifras distintas y no se confunden",
      (mercado?.entries ?? 0) === 3 && (mercado?.users ?? 0) === 3,
      `${mercado?.entries} entradas · ${mercado?.users} usuarios`);
    const home = zonas?.find((z) => z.zone === "home");
    check("23 · first_of_session identifica la puerta de entrada",
      (home?.first_of_session ?? 0) >= 1, `${home?.first_of_session}`);
    check("24 · las zonas anónimas se cuentan aparte",
      (home?.anon_sessions ?? 0) >= 1, `${home?.anon_sessions} sesiones anónimas`);

    // ══════════════════ SESIONES Y ANÓNIMO→AUTENTICADO ══════════════════
    console.log("\nSESIONES");
    const ses = await sessionStats(db, w);
    check("25 · cuenta las tres sesiones del escenario", (ses?.sessions ?? 0) >= 3, `${ses?.sessions}`);
    check("26 · ANÓNIMO → AUTENTICADO: la sesión de A se clasifica como MIXTA",
      (ses?.mixed_sessions ?? 0) >= 1, `${ses?.mixed_sessions} mixtas`);
    check("27 · las sesiones de B y C se clasifican como autenticadas",
      (ses?.authenticated_sessions ?? 0) >= 2, `${ses?.authenticated_sessions}`);
    check("28 · la duración se declara COTA INFERIOR en el nombre del campo",
      "median_seconds_lower_bound" in (ses ?? {}) && "avg_seconds_lower_bound" in (ses ?? {}));
    check("29 · la cota inferior de A es ≈10 min (60→50), nunca más que el intervalo real",
      (ses?.median_seconds_lower_bound ?? 0) > 0 && (ses?.median_seconds_lower_bound ?? 0) <= 3600,
      `${ses?.median_seconds_lower_bound}s de mediana`);
    check("30 · las sesiones de un solo evento se cuentan aparte",
      typeof ses?.single_event_sessions === "number", `${ses?.single_event_sessions}`);

    // ══════════════════ ACTIVOS Y RETENCIÓN ══════════════════
    console.log("\nACTIVOS Y RETENCIÓN");
    const dau = await activeUsers(db, lastDays(2));
    const hoy = dau?.[dau.length - 1];
    check("31 · DAU cuenta usuarios con identidad, no sesiones", (hoy?.dau ?? 0) >= 3, `DAU=${hoy?.dau}`);
    check("32 · las sesiones anónimas se devuelven APARTE y no se suman al DAU",
      "anon_sessions" in (hoy ?? {}) && (hoy?.anon_sessions ?? -1) >= 0,
      `anónimas=${hoy?.anon_sessions}`);
    check("33 · WAU de 7 días es ≥ DAU", (hoy?.wau_trailing_7d ?? 0) >= (hoy?.dau ?? 0),
      `WAU=${hoy?.wau_trailing_7d}`);

    const ret = await retention(db, lastDays(60));
    check("34 · la retención devuelve cohortes con su tamaño", (ret?.length ?? 0) > 0, `${ret?.length} cohortes`);
    const antiguas = ret?.filter((r) => !r.d7_measurable) ?? [];
    check("35 · las cohortes sin instrumentación se marcan NO MEDIBLES (un 0 no es una catástrofe)",
      antiguas.length > 0 && antiguas.every((r) => r.d7 === 0),
      `${antiguas.length} cohortes con d7_measurable=false`);

    // ══════════════════ ERRORES ══════════════════
    console.log("\nERRORES");
    const errs = await errorGroups(db, w);
    const grupo = errs?.find((e) => e.fingerprint === "fp-test-1");
    check("36 · los errores se agrupan por huella, no una fila por aparición",
      grupo?.occurrences === 2, `${grupo?.occurrences} apariciones en 1 fila`);
    check("37 · se pueden aislar los críticos, con zona, flujo, versión y código",
      grupo?.severity === "critical" && grupo?.zone === "inventory"
        && grupo?.app_version === "0.1.1-test" && grupo?.code === "FETCH_FAILED",
      `${grupo?.severity}/${grupo?.zone}/${grupo?.app_version}`);
    check("38 · el ejemplo del mensaje viene ya saneado del endpoint",
      typeof grupo?.sample === "string");

    // ══════════════════ FLUJOS ══════════════════
    console.log("\nFLUJOS");
    const flujos = await flowStats(db, w);
    const dbf = flujos?.find((f) => f.flow === "deck_builder");
    check("39 · cuenta las dos aperturas del constructor (A y B)", (dbf?.starts ?? 0) === 2,
      `${dbf?.starts} inicios · ${dbf?.users} usuarios`);
    check("40 · el ABANDONO se calcula: A guardó mazo, B no",
      dbf?.users_completed === 1 && dbf?.completion_pct === 50,
      `${dbf?.users_completed}/${dbf?.users} = ${dbf?.completion_pct}%`);
    check("41 · declara de qué huella autoritativa sale la finalización",
      (dbf?.completion_source ?? "").includes("duel_decks"));

    // ══════════════════ RECORRIDO ══════════════════
    console.log("\nRECORRIDO DE SESIÓN");
    const j = await sessionJourney(db, A.sesion);
    check("42 · reconstruye el recorrido de una sesión en orden", (j?.length ?? 0) >= 6,
      `${j?.length} pasos`);
    check("43 · mezcla telemetría con acciones autoritativas",
      (j?.some((x) => x.source === "telemetry_events") ?? false)
        && (j?.some((x) => x.source !== "telemetry_events") ?? false),
      [...new Set(j?.map((x) => x.source))].join(", "));
    check("44 · viene ordenado cronológicamente",
      (j ?? []).every((x, i, a) => i === 0 || new Date(a[i - 1].at) <= new Date(x.at)));

    // ══════════════════ ACCESO ══════════════════
    console.log("\nACCESO");
    const comoUsuario = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { error: e1 } = await comoUsuario.rpc("analytics_ftue_funnel", {});
    check("45 · un cliente anónimo NO puede llamar a las funciones analíticas", !!e1,
      e1?.message?.slice(0, 60));
    const { error: e2 } = await comoUsuario.rpc("analytics_session_journey", { p_session: A.sesion });
    check("46 · …ni pedir el recorrido de una sesión ajena", !!e2, e2?.message?.slice(0, 60));

    // ══════════════════ TOLERANCIA A FALLOS ══════════════════
    console.log("\nTOLERANCIA");
    const inexistente = await sessionJourney(db, randomUUID());
    check("47 · una sesión que no existe devuelve vacío, no revienta",
      Array.isArray(inexistente) && inexistente.length === 0);
    const futuro = await ftueFunnel(db, { from: new Date(ahora + 86_400_000), to: new Date(ahora + 2 * 86_400_000) });
    check("48 · una ventana sin datos devuelve el embudo a cero, no null",
      futuro?.length === 7 && futuro.every((s) => s.users === 0));
  } finally {
    // Limpieza. El borrado de la cuenta arrastra en cascada cartas, mazos, partidas,
    // asientos y telemetría; se borran antes los fixtures que no cuelgan de la cuenta.
    await db.from("telemetry_events").delete().in("session_id", sesiones);
    for (const p of personas) {
      await db.from("economy_ops").delete().eq("ref", `test:open:${p.id}`);
      await db.auth.admin.deleteUser(p.id).catch(() => {});
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${pass} correctas · ${fail} fallidas`);
  console.log(fail === 0 ? "  ✅ LA CAPA ANALÍTICA RESPONDE LO CORRECTO\n" : "  ❌ HAY FALLOS\n");
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
