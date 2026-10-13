/**
 * PRUEBAS DE INTEGRACIÓN de Pick'ems contra base de datos REAL.
 *
 *   npm run test:pickems       (requiere `npx supabase start` + `npm run seed:demo`)
 *
 * CUBRE
 *   TEST 5  · se puede crear una predicción antes del cierre
 *   TEST 6  · NO se puede modificar después del cierre (invariante del bloque)
 *   TEST 7  · un acierto concede puntos
 *   TEST 8  · un fallo no concede puntos
 *   TEST 9  · una recompensa no se puede reclamar dos veces
 *   TEST 11 · el ranking deriva de datos reales, no autodeclarados
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!URL_ || !ANON || !SERVICE) {
  console.error("❌ No hay base de datos configurada. Ejecuta: npx supabase start");
  process.exit(1);
}

let failures = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const created: string[] = [];

async function makeUser(tag: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `pk-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `pk_${tag}` },
  });
  if (error || !data.user) throw new Error(error?.message);
  const client = createClient(URL_!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
  await client.auth.signInWithPassword({ email, password });
  created.push(data.user.id);
  return { id: data.user.id, client };
}

/**
 * El seed es IDEMPOTENTE y se reejecuta aquí a propósito.
 *
 * Estas pruebas necesitan un torneo con preguntas abiertas Y alguna cerrada. Si se
 * ejecutan después de haber avanzado la demo con `npm run demo:resolve`, ya no queda
 * ninguna abierta y el guion se caía sin decir por qué. Sembrar al empezar hace que
 * el resultado no dependa del punto en el que se dejó la demostración.
 */
function reseedDemo(): void {
  // Node con el cargador `tsx`, sin shell: evita depender del resolutor de `npx` y
  // de cómo cada plataforma escapa los argumentos.
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/seed-demo.ts"], {
    stdio: "ignore", shell: false,
  });
  if (r.status !== 0) {
    console.error("❌ No se pudo sembrar la demo. Ejecuta a mano: npm run seed:demo");
    process.exit(1);
  }
}

async function main() {
  console.log("# Pruebas de integración — Pick'ems, scoring, recompensas y ranking\n");

  reseedDemo();

  const { data: pe } = await admin.from("pickem_events")
    .select("id, event_id").eq("event_id", "demo-masters-madrid-2026").maybeSingle();
  if (!pe) { console.error("❌ Falta el seed. Ejecuta: npm run seed:demo"); process.exit(1); }

  const { data: questions } = await admin.from("pickem_questions")
    .select("id, prompt, options, points, locks_at, kind, match_id")
    .eq("pickem_event_id", pe.id).order("order_idx");
  const qs = questions ?? [];

  const now = Date.now();
  const openQs = qs.filter((q) => new Date(q.locks_at).getTime() > now);
  const lockedQs = qs.filter((q) => new Date(q.locks_at).getTime() <= now);
  check("el seed deja preguntas abiertas y al menos una cerrada",
    openQs.length >= 2 && lockedQs.length >= 1, `abiertas=${openQs.length} cerradas=${lockedQs.length}`);

  const { submitPick, scorePickemEvent, setCorrectOption } = await import("../src/server/services/pickems");

  // ─────────────────────── Ocultación de la respuesta ───────────────────────
  console.log("\n## La respuesta correcta no se filtra antes del cierre");
  {
    const anonClient = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    const { error: rawErr } = await anonClient.from("pickem_questions").select("correct_option").limit(1);
    check("la tabla base de preguntas no es legible por el cliente", !!rawErr, rawErr?.message?.slice(0, 50));

    const { data: pub } = await anonClient.from("pickem_questions_public")
      .select("id, locked, correct_option").eq("pickem_event_id", pe.id);
    const leaking = (pub ?? []).filter((q) => !q.locked && q.correct_option !== null);
    check("la vista pública oculta correct_option mientras la pregunta está abierta", leaking.length === 0);
  }

  const alice = await makeUser("alice");
  const bob = await makeUser("bob");

  // ─────────────────────── TEST 5 ───────────────────────
  console.log("\n## TEST 5 · se puede predecir ANTES del cierre");
  const target = openQs.find((q) => q.kind === "match_winner")!;
  const optA = (target.options as { key: string }[])[0].key;
  const optB = (target.options as { key: string }[])[1].key;
  {
    const res = await submitPick(admin, alice.id, target.id, optA);
    check("se guarda la predicción", res.ok, res.ok ? "" : res.error);

    const { data: sub } = await admin.from("pickem_submissions")
      .select("id").eq("user_id", alice.id).eq("pickem_event_id", pe.id).maybeSingle();
    check("se crea el envío del usuario", !!sub);

    const { data: ans } = await admin.from("pickem_answers")
      .select("option_key").eq("submission_id", sub!.id).eq("question_id", target.id).maybeSingle();
    check("la respuesta queda persistida", ans?.option_key === optA, `option=${ans?.option_key}`);

    // Cambiar de opinión antes del cierre debe funcionar.
    const change = await submitPick(admin, alice.id, target.id, optB);
    const { data: ans2 } = await admin.from("pickem_answers")
      .select("option_key").eq("submission_id", sub!.id).eq("question_id", target.id).maybeSingle();
    check("se puede cambiar la predicción antes del cierre", change.ok && ans2?.option_key === optB);

    // La dejamos en optA para el test de scoring.
    await submitPick(admin, alice.id, target.id, optA);
  }

  // ─────────────────────── TEST 6 ───────────────────────
  console.log("\n## TEST 6 · NO se puede predecir DESPUÉS del cierre");
  {
    const locked = lockedQs[0];
    const lockedOpt = (locked.options as { key: string }[])[0].key;
    const res = await submitPick(admin, alice.id, locked.id, lockedOpt);
    check("el servidor rechaza la predicción cerrada", !res.ok && res.status === 409,
      res.ok ? "LA ACEPTÓ" : res.error);

    const { data: sub } = await admin.from("pickem_submissions")
      .select("id").eq("user_id", alice.id).eq("pickem_event_id", pe.id).maybeSingle();
    const { data: ans } = await admin.from("pickem_answers")
      .select("id").eq("submission_id", sub!.id).eq("question_id", locked.id).maybeSingle();
    check("no queda ninguna respuesta guardada para esa pregunta", !ans);

    // Y tampoco escribiendo directamente contra las tablas.
    const { error: directErr } = await alice.client.from("pickem_answers")
      .insert({ submission_id: sub!.id, question_id: locked.id, option_key: lockedOpt });
    check("el cliente tampoco puede insertar la respuesta a mano", !!directErr,
      directErr?.message?.slice(0, 50));

    const { error: rpcErr } = await alice.client.rpc("app_submit_pick", {
      p_user: alice.id, p_question_id: locked.id, p_option: lockedOpt,
    });
    check("la RPC de predicción no es invocable por el cliente", !!rpcErr);
  }

  // ─────────────────────── Validación de opción ───────────────────────
  console.log("\n## Validación de la opción enviada");
  {
    const res = await submitPick(admin, alice.id, target.id, "equipo-que-no-existe");
    check("se rechaza una opción que no está entre las declaradas", !res.ok && res.status === 400);
  }

  // ─────────────────────── TEST 7 y 8 ───────────────────────
  console.log("\n## TEST 7 y 8 · acierto concede puntos, fallo no");
  {
    await submitPick(admin, bob.id, target.id, optB); // Bob predice lo contrario

    // Resultado real: gana optA → Alice acierta, Bob falla.
    await setCorrectOption(admin, target.id, optA);
    const scored = await scorePickemEvent(admin, pe.id);
    check("el corrector se ejecuta", scored.ok, scored.ok ? "" : scored.error);

    const { data: aliceScore } = await admin.from("pickem_scores")
      .select("points, correct, total").eq("user_id", alice.id).eq("pickem_event_id", pe.id).maybeSingle();
    const { data: bobScore } = await admin.from("pickem_scores")
      .select("points, correct, total").eq("user_id", bob.id).eq("pickem_event_id", pe.id).maybeSingle();

    check(`TEST 7 · el acierto concede los puntos de la pregunta (${target.points})`,
      aliceScore?.points === target.points, `alice=${aliceScore?.points}`);
    check("TEST 7 · se registra como acierto", aliceScore?.correct === 1);
    check("TEST 8 · el fallo NO concede puntos", bobScore?.points === 0, `bob=${bobScore?.points}`);
    check("TEST 8 · se registra como fallo", bobScore?.correct === 0);

    const { data: aliceProf } = await admin.from("profiles").select("points").eq("id", alice.id).maybeSingle();
    check("los puntos llegan al perfil (columna server-only)",
      Number(aliceProf?.points) === target.points, `points=${aliceProf?.points}`);
  }

  // ─────────────────────── TEST 9 ───────────────────────
  console.log("\n## TEST 9 · una recompensa no se concede dos veces");
  {
    const { data: before } = await admin.from("profiles")
      .select("credits, xp").eq("id", alice.id).maybeSingle();
    const { count: txBefore } = await admin.from("credit_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", alice.id).like("ref", "pickem:%");
    check("tras la primera corrección hay exactamente 1 asiento de recompensa",
      (txBefore ?? 0) === 1, `asientos=${txBefore}`);

    // Recorregir el mismo Pick'em varias veces.
    await scorePickemEvent(admin, pe.id);
    await scorePickemEvent(admin, pe.id);

    const { data: after } = await admin.from("profiles")
      .select("credits, xp, points").eq("id", alice.id).maybeSingle();
    const { count: txAfter } = await admin.from("credit_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", alice.id).like("ref", "pickem:%");

    check("no se añaden más asientos de recompensa", (txAfter ?? 0) === 1, `asientos=${txAfter}`);
    check("los créditos no se duplican", Number(after?.credits) === Number(before?.credits),
      `${before?.credits} → ${after?.credits}`);
    check("el XP no se duplica", Number(after?.xp) === Number(before?.xp));
    check("los puntos no se inflan al recorregir", Number(after?.points) === target.points,
      `points=${after?.points}`);
  }

  // ─────────────────────── TEST 11 ───────────────────────
  console.log("\n## TEST 11 · el ranking deriva de datos reales");
  {
    const anonClient = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    const { data: ranking } = await anonClient.from("ranking_points")
      .select("id, username, points").limit(100);
    const aliceRow = (ranking ?? []).find((r) => r.id === alice.id);
    check("el usuario que acertó aparece en el ranking global", !!aliceRow,
      `filas=${ranking?.length}`);
    check("con los puntos que le dio el corrector", aliceRow?.points === target.points);

    const bobRow = (ranking ?? []).find((r) => r.id === bob.id);
    check("el usuario con 0 puntos no aparece", !bobRow);

    // Y no puede escribírselos.
    const { error: writeErr } = await alice.client.from("profiles")
      .update({ points: 99999 }).eq("id", alice.id);
    const { data: stillProf } = await admin.from("profiles").select("points").eq("id", alice.id).maybeSingle();
    check("el usuario no puede escribir sus propios puntos", !!writeErr);
    check("los puntos siguen siendo los del corrector", Number(stillProf?.points) === target.points);

    const { data: perEvent } = await anonClient.from("ranking_pickem_event")
      .select("user_id, points").eq("pickem_event_id", pe.id);
    check("existe ranking POR TORNEO", (perEvent ?? []).length >= 2, `filas=${perEvent?.length}`);
  }

  console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
}

main()
  .catch((e) => { console.error("\n💥", e); failures++; })
  .finally(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
    process.exit(failures === 0 ? 0 : 1);
  });
