/**
 * PRUEBA E2E POR HTTP — ejercita las RUTAS API reales, no los servicios.
 *
 *   npm run dev            (en otra terminal)
 *   npm run test:e2e
 *
 * Comprueba lo que los tests de integración no pueden: que las rutas
 * `/api/game/*` y `/api/pickems` autentican, validan la entrada y devuelven los
 * códigos correctos. Es la diferencia entre "el servicio funciona" y "el usuario
 * puede usarlo".
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

let failures = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
let userId = "";

async function main() {
  console.log(`# E2E por HTTP — ${BASE}\n`);

  // ¿Está el servidor arriba Y es EL NUESTRO?
  // (En esta máquina el puerto 3000 lo ocupa otra aplicación que también devuelve
  // 401. Comprobar solo el código de estado daba un falso verde contra la app
  // equivocada, así que se verifica también la forma de la respuesta.)
  try {
    const ping = await fetch(`${BASE}/api/game/state`);
    const body = await ping.json().catch(() => ({}));
    const isOurs = ping.status === 401 && body?.error === "No autenticado";
    check("el servidor responde y es esta aplicación", isOurs,
      isOurs ? "" : `status=${ping.status} body=${JSON.stringify(body).slice(0, 60)}`);
    if (!isOurs) {
      console.error(`\n❌ ${BASE} no es DRL Champions. ¿Hay otra app en ese puerto?`);
      console.error("   Arranca el servidor y pasa el puerto correcto:");
      console.error("   E2E_BASE_URL=http://127.0.0.1:3001 npm run test:e2e");
      process.exit(1);
    }
    check("sin token devuelve 401 (no filtra nada)", ping.status === 401);
  } catch {
    console.error("❌ No hay servidor en " + BASE + ". Arranca `npm run dev` primero.");
    process.exit(1);
  }

  // Usuario real
  const email = `e2e-${Date.now()}@example.invalid`;
  const password = "Test-1234-e2e";
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: "e2e" },
  });
  if (error || !created.user) throw new Error(error?.message);
  userId = created.user.id;

  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signin } = await client.auth.signInWithPassword({ email, password });
  const token = signin.session!.access_token;
  const H = { "content-type": "application/json", authorization: `Bearer ${token}` };

  // ── Estado ──
  console.log("\n## GET /api/game/state");
  {
    const res = await fetch(`${BASE}/api/game/state`, { headers: H });
    const json = await res.json();
    check("responde 200 con token", res.status === 200);
    check("trae el saldo de partida", json.credits === 6000, `credits=${json.credits}`);
    check("trae los sobres de bienvenida", json.unopenedPacks?.inicial === 3);
    check("el inventario empieza vacío", (json.ownedCards ?? []).length === 0);
  }

  // ── Validación de entrada ──
  console.log("\n## POST /api/game/packs · validación");
  {
    const bad = await fetch(`${BASE}/api/game/packs`, {
      method: "POST", headers: H, body: JSON.stringify({ action: "nope", packId: "inicial" }) });
    check("acción desconocida → 400", bad.status === 400);

    const badPack = await fetch(`${BASE}/api/game/packs`, {
      method: "POST", headers: H, body: JSON.stringify({ action: "open", packId: "../../etc" }) });
    check("packId con forma inválida → 400", badPack.status === 400);

    const noAuth = await fetch(`${BASE}/api/game/packs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "open", packId: "inicial" }) });
    check("sin token → 401", noAuth.status === 401);
  }

  // ── Abrir sobre por HTTP ──
  console.log("\n## POST /api/game/packs · abrir");
  {
    const res = await fetch(`${BASE}/api/game/packs`, {
      method: "POST", headers: H, body: JSON.stringify({ action: "open", packId: "inicial" }) });
    const json = await res.json();
    check("responde 200", res.status === 200, JSON.stringify(json).slice(0, 80));
    check("devuelve 5 cartas", (json.opened ?? []).length === 5);
    check("concede XP", json.xpGained > 0);

    const { data: cards } = await admin.from("user_cards").select("uid").eq("user_id", userId);
    check("las cartas están en la base de datos", (cards ?? []).length === 5, `${cards?.length}`);

    const noStock = await fetch(`${BASE}/api/game/packs`, {
      method: "POST", headers: H, body: JSON.stringify({ action: "open", packId: "champions" }) });
    check("abrir un sobre que no se tiene → 409", noStock.status === 409);
  }

  // ── Comprar sin saldo ──
  console.log("\n## POST /api/game/packs · comprar sin saldo");
  {
    await admin.rpc("app_adjust_credits", {
      p_user: userId, p_delta: -6000, p_reason: "e2e_drain", p_ref: `e2e-drain:${userId}` });
    const res = await fetch(`${BASE}/api/game/packs`, {
      method: "POST", headers: H, body: JSON.stringify({ action: "buy", packId: "premium" }) });
    const json = await res.json();
    check("responde 409", res.status === 409, json.error);
    check("el mensaje es claro y en español", /créditos insuficientes/i.test(json.error ?? ""));
  }

  // ── Pick'ems por HTTP ──
  console.log("\n## POST /api/pickems");
  {
    const { data: pe } = await admin.from("pickem_events")
      .select("id").eq("event_id", "demo-masters-madrid-2026").maybeSingle();
    if (!pe) { console.log("  (sin seed: omitido)"); }
    else {
      const { data: qs } = await admin.from("pickem_questions")
        .select("id, options, locks_at").eq("pickem_event_id", pe.id);
      const now = Date.now();
      const open = (qs ?? []).find((q) => new Date(q.locks_at).getTime() > now)!;
      const locked = (qs ?? []).find((q) => new Date(q.locks_at).getTime() <= now)!;

      const badId = await fetch(`${BASE}/api/pickems`, {
        method: "POST", headers: H, body: JSON.stringify({ questionId: "no-uuid", option: "x" }) });
      check("questionId no-UUID → 400", badId.status === 400);

      const optKey = (open.options as { key: string }[])[0].key;
      const ok = await fetch(`${BASE}/api/pickems`, {
        method: "POST", headers: H, body: JSON.stringify({ questionId: open.id, option: optKey }) });
      check("predicción abierta → 200", ok.status === 200, String(ok.status));

      const bad = await fetch(`${BASE}/api/pickems`, {
        method: "POST", headers: H, body: JSON.stringify({ questionId: open.id, option: "inventado" }) });
      check("opción no declarada → 400", bad.status === 400);

      const closed = await fetch(`${BASE}/api/pickems`, {
        method: "POST", headers: H,
        body: JSON.stringify({ questionId: locked.id, option: (locked.options as { key: string }[])[0].key }) });
      const closedJson = await closed.json();
      check("predicción cerrada → 409", closed.status === 409, closedJson.error);

      const noAuth = await fetch(`${BASE}/api/pickems`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId: open.id, option: optKey }) });
      check("sin token → 401", noAuth.status === 401);
    }
  }

  console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
}

main()
  .catch((e) => { console.error("\n💥", e); failures++; })
  .finally(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
    process.exit(failures === 0 ? 0 : 1);
  });
