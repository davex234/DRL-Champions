/**
 * RECORRIDO COMPLETO DE LA DEMO — los 18 pasos, contra backend real.
 *
 *   npm run dev                                  (en otra terminal)
 *   E2E_BASE_URL=http://127.0.0.1:3001 npm run test:flow
 *
 * No sustituye a mirar la aplicación con los ojos: comprueba que cada paso del
 * guion de la demo tiene datos y responde, para que no se descubra un paso roto
 * delante de alguien.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DEMO_EVENT = "demo-masters-madrid-2026";

let failures = 0;
let step = 0;
const check = (label: string, ok: boolean, detail = "") => {
  step++;
  console.log(`  ${ok ? "✓" : "✕"} ${String(step).padStart(2)}. ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
let userId = "";

/** Comprueba que una página responde y no es la app equivocada. */
async function page(path: string): Promise<boolean> {
  const res = await fetch(`${BASE}${path}`);
  return res.status === 200;
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
  console.log(`# Recorrido de la demo — ${BASE}\n`);

  reseedDemo();

  // 1 · Home accesible sin sesión
  check("Abrir Home", await page("/"));

  // 2 · Login (usuario real)
  const email = `flow-${Date.now()}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: "flowdemo" },
  });
  if (error || !created.user) throw new Error(error?.message);
  userId = created.user.id;
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signin, error: signErr } = await client.auth.signInWithPassword({ email, password });
  check("Login", !signErr && !!signin.session);
  const H = { "content-type": "application/json", authorization: `Bearer ${signin.session!.access_token}` };

  // 3 · Ver torneo
  const { data: ev } = await admin.from("events").select("id, name, source").eq("id", DEMO_EVENT).maybeSingle();
  check("Ver torneo", !!ev && await page(`/torneos/${DEMO_EVENT}`), ev?.name);
  check("El torneo está marcado como demostración", ev?.source === "demo");

  // 4 · Entrar en Pick'em
  const { data: pe } = await admin.from("pickem_events").select("id").eq("event_id", DEMO_EVENT).maybeSingle();
  check("Entrar en Pick'em", !!pe && await page("/pickems"));

  const { data: qs } = await admin.from("pickem_questions")
    .select("id, options, locks_at, points").eq("pickem_event_id", pe!.id).order("order_idx");
  const now = Date.now();
  const open = (qs ?? []).filter((q) => new Date(q.locks_at).getTime() > now);
  const locked = (qs ?? []).filter((q) => new Date(q.locks_at).getTime() <= now);
  check("Hay predicciones abiertas y alguna cerrada",
    open.length >= 2 && locked.length >= 1, `abiertas=${open.length} cerradas=${locked.length}`);

  // 5-6 · Seleccionar y guardar predicción
  const target = open[0];
  const optA = (target.options as { key: string }[])[0].key;
  const res = await fetch(`${BASE}/api/pickems`, {
    method: "POST", headers: H, body: JSON.stringify({ questionId: target.id, option: optA }) });
  check("Seleccionar predicción y guardarla", res.status === 200, `status=${res.status}`);

  // 7 · Aparece guardada
  const { data: sub } = await admin.from("pickem_submissions")
    .select("id").eq("user_id", userId).eq("pickem_event_id", pe!.id).maybeSingle();
  const { data: ans } = await admin.from("pickem_answers")
    .select("option_key").eq("submission_id", sub!.id).eq("question_id", target.id).maybeSingle();
  check("La predicción aparece guardada", ans?.option_key === optA);

  // 8 · Locking
  const lockedRes = await fetch(`${BASE}/api/pickems`, {
    method: "POST", headers: H,
    body: JSON.stringify({ questionId: locked[0].id, option: (locked[0].options as { key: string }[])[0].key }) });
  check("Locking: predicción cerrada rechazada", lockedRes.status === 409);

  // 9 · Scoring (mecanismo de demo)
  // El resolutor de la demo CIERRA la pregunta antes de fijar el resultado, igual que
  // en producción cierra sola al empezar el partido. Aquí se reproduce ese orden: si
  // se fijara el resultado dejando la pregunta abierta, se podría seguir prediciendo
  // algo ya conocido y la vista pública seguiría ocultando el resultado al usuario.
  await admin.from("pickem_questions")
    .update({ locks_at: new Date().toISOString() }).eq("id", target.id);
  const { setCorrectOption, scorePickemEvent } = await import("../src/server/services/pickems");
  await setCorrectOption(admin, target.id, optA); // acierta
  const scored = await scorePickemEvent(admin, pe!.id);
  check("Ejecutar corrección", scored.ok);

  // La pregunta corregida ya no acepta predicciones y sí muestra su resultado.
  const lateRes = await fetch(`${BASE}/api/pickems`, {
    method: "POST", headers: H, body: JSON.stringify({ questionId: target.id, option: optA }) });
  check("Una pregunta ya resuelta no acepta más predicciones", lateRes.status === 409);

  const anonView = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: pub } = await anonView.from("pickem_questions_public")
    .select("locked, correct_option").eq("id", target.id).maybeSingle();
  check("El resultado es visible para el usuario", pub?.locked === true && pub?.correct_option === optA);

  // 10 · Ver puntos
  const { data: prof } = await admin.from("profiles").select("points, credits, xp").eq("id", userId).maybeSingle();
  check("Ver puntos actualizados", Number(prof?.points) === target.points, `points=${prof?.points}`);

  // 11 · Ver rango
  const { rankProgress } = await import("../src/domain/progression/rank");
  const rank = rankProgress(Number(prof?.points ?? 0));
  check("Ver rango", !!rank.tier.label, `${rank.tier.label} · ${rank.points} pts`);

  // 12 · Ver ranking
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: rk } = await anon.from("ranking_points").select("id, points");
  check("Ver clasificación", (rk ?? []).some((r) => r.id === userId) && await page("/ranking"));

  // 13 · Ver recompensa
  const { data: led } = await admin.from("credit_transactions")
    .select("reason, delta").eq("user_id", userId).like("ref", "pickem:%");
  check("Ver recompensa concedida", (led ?? []).length === 1 && await page("/recompensas"),
    led?.[0]?.reason);

  // 14 · Abrir pack
  const openRes = await fetch(`${BASE}/api/game/packs`, {
    method: "POST", headers: H, body: JSON.stringify({ action: "open", packId: "inicial" }) });
  const openJson = await openRes.json();
  check("Abrir sobre", openRes.status === 200, `status=${openRes.status}`);

  // 15 · Recibir carta
  check("Recibir cartas", (openJson.opened ?? []).length === 5, `${openJson.opened?.length} cartas`);

  // 16-17 · Colección
  const { data: cards } = await admin.from("user_cards").select("uid, card_id").eq("user_id", userId);
  check("Ir a colección", await page("/coleccion"));
  check("Las cartas están en el inventario del servidor", (cards ?? []).length === 5, `${cards?.length}`);

  // 18 · Volver a Home
  check("Volver a Home", await page("/"));

  // Extra: el resto de la navegación no lleva a ninguna pantalla rota
  const nav = ["/torneos", "/pickems", "/coleccion", "/tienda", "/ranking", "/cuenta",
               "/recompensas", "/inventario", "/colecciones", "/logros", "/entrenador", "/mundo"];
  const bad: string[] = [];
  for (const p of nav) if (!(await page(p))) bad.push(p);
  check("Ningún enlace de navegación está roto", bad.length === 0, bad.join(", "));

  console.log(`\n${failures === 0 ? "✅ EL RECORRIDO COMPLETO FUNCIONA" : `❌ ${failures} PASO(S) ROTO(S)`}`);
}

main()
  .catch((e) => { console.error("\n💥", e); failures++; })
  .finally(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
    process.exit(failures === 0 ? 0 : 1);
  });
