/**
 * PRUEBAS DE INTEGRACIÓN contra una base de datos Supabase REAL.
 *
 *   npm run test:integration          (requiere `npx supabase start` o .env.local apuntando a un proyecto)
 *
 * POR QUÉ NO ESTÁ EN `verify:all`
 *   `verify:all` corre en CI sin base de datos. Un test que se auto-omite en silencio
 *   da falsa confianza — justo lo que la auditoría criticó. Así que este fichero se
 *   ejecuta aparte y FALLA si no encuentra base de datos, en vez de fingir que pasa.
 *
 * QUÉ CUBRE (numeración del encargo)
 *   TEST 1  · un usuario no puede modificar sus créditos
 *   TEST 2  · un usuario no puede inventarse una carta
 *   TEST 3  · no se puede comprar un sobre sin saldo
 *   TEST 4  · abrir un sobre crea las cartas en servidor
 *   TEST 10 · un usuario no puede modificar sus puntos/rango
 *   TEST 12 · el usuario A no puede modificar los datos del usuario B
 *   (5-9 y 11, de Pick'ems/scoring/ranking, en `scripts/pickems-integration-test.ts`)
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ── Carga de .env.local (ni Node ni tsx lo hacen solos) ─────────────────────
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
  console.error("❌ No hay base de datos configurada.");
  console.error("   Levanta el entorno local con:  npx supabase start");
  console.error("   y asegúrate de que .env.local tiene URL, ANON y SERVICE_ROLE.");
  process.exit(1);
}

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✕"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

/** Crea un usuario confirmado y devuelve su id + un cliente autenticado como él. */
async function makeUser(tag: string): Promise<{ id: string; client: SupabaseClient; email: string }> {
  const email = `it-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`;
  const password = ephemeralQaPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `it_${tag}` },
  });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario: ${error?.message}`);

  const client = createClient(URL_!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`No se pudo iniciar sesión: ${signInErr.message}`);
  return { id: data.user.id, client, email };
}

const created: string[] = [];

async function main() {
  console.log("# Pruebas de integración — MVP server-authoritative\n");
  console.log(`  base de datos: ${URL_}\n`);

  // ─────────────────────── Alta de usuario ───────────────────────
  console.log("## Alta de usuario (trigger handle_new_user)");
  const alice = await makeUser("alice");
  created.push(alice.id);

  const { data: profile } = await admin.from("profiles")
    .select("credits, xp, is_admin").eq("id", alice.id).maybeSingle();
  check("se crea el perfil con el saldo de partida", Number(profile?.credits) === 6000, `credits=${profile?.credits}`);
  check("el usuario NO nace administrador", profile?.is_admin === false);

  const { data: starterPacks } = await admin.from("user_packs")
    .select("pack_id, qty").eq("user_id", alice.id).order("pack_id");
  const packMap = Object.fromEntries((starterPacks ?? []).map((p) => [p.pack_id, p.qty]));
  check("recibe los sobres de bienvenida en SERVIDOR", packMap.inicial === 3 && packMap.estandar === 1,
    JSON.stringify(packMap));

  const { data: ledger } = await admin.from("credit_transactions")
    .select("delta, reason, balance_after").eq("user_id", alice.id);
  check("el saldo inicial queda asentado en el libro mayor",
    (ledger ?? []).length === 1 && ledger![0].delta === 6000 && ledger![0].balance_after === 6000);

  // ─────────────────────── TEST 1 ───────────────────────
  console.log("\n## TEST 1 · un usuario no puede modificar sus créditos");
  {
    const { error } = await alice.client.from("profiles").update({ credits: 999999999 }).eq("id", alice.id);
    const { data: after } = await admin.from("profiles").select("credits").eq("id", alice.id).maybeSingle();
    check("PostgREST rechaza el UPDATE de credits", !!error, error?.message?.slice(0, 60));
    check("el saldo NO ha cambiado", Number(after?.credits) === 6000, `credits=${after?.credits}`);
  }

  // ─────────────────────── TEST 10 ───────────────────────
  console.log("\n## TEST 10 · un usuario no puede modificar sus puntos / rango");
  {
    const { error: xpErr } = await alice.client.from("profiles").update({ xp: 999999 }).eq("id", alice.id);
    const { error: adminErr } = await alice.client.from("profiles").update({ is_admin: true }).eq("id", alice.id);
    const { data: after } = await admin.from("profiles").select("xp, is_admin").eq("id", alice.id).maybeSingle();
    check("rechaza el UPDATE de xp", !!xpErr);
    check("rechaza la autoconcesión de is_admin", !!adminErr);
    check("xp e is_admin intactos", Number(after?.xp) === 0 && after?.is_admin === false);
  }

  // ─────────────────────── TEST 2 ───────────────────────
  console.log("\n## TEST 2 · un usuario no puede inventarse una carta");
  {
    const { error } = await alice.client.from("user_cards")
      .insert({ user_id: alice.id, card_id: "derke__champions-mvp", serial: 1, origin: "pack" });
    check("PostgREST rechaza el INSERT en user_cards", !!error, error?.message?.slice(0, 60));

    const { error: packErr } = await alice.client.from("user_packs")
      .upsert({ user_id: alice.id, pack_id: "champions", qty: 99 });
    check("PostgREST rechaza el INSERT/UPSERT en user_packs", !!packErr);

    const { error: rpcErr } = await alice.client.rpc("app_grant_cards", {
      p_user: alice.id,
      p_instances: [{ cardId: "derke__champions-mvp", serial: 1, origin: "pack" }],
      p_mint_delta: {},
      p_origin: "pack",
    });
    check("la RPC app_grant_cards NO es invocable por el cliente", !!rpcErr, rpcErr?.message?.slice(0, 60));

    const { error: creditRpcErr } = await alice.client.rpc("app_adjust_credits", {
      p_user: alice.id, p_delta: 1000000, p_reason: "hack", p_ref: null,
    });
    check("la RPC app_adjust_credits NO es invocable por el cliente", !!creditRpcErr);

    const { count } = await admin.from("user_cards")
      .select("uid", { count: "exact", head: true }).eq("user_id", alice.id);
    check("el inventario del usuario sigue vacío", (count ?? -1) === 0, `cartas=${count}`);
  }

  // ─────────────────────── TEST 4 ───────────────────────
  console.log("\n## TEST 4 · abrir un sobre crea las cartas EN SERVIDOR");
  {
    const { openPackForUser } = await import("../src/server/services/packs");
    const res = await openPackForUser(admin, alice.id, "inicial");
    check("la apertura devuelve ok", res.ok, res.ok ? "" : res.error);
    if (res.ok) {
      check("devuelve 5 cartas (cardCount del sobre 'inicial')", res.data.opened.length === 5,
        `${res.data.opened.length}`);
      check("todas las cartas traen uid de servidor",
        res.data.opened.every((c) => /^[0-9a-f-]{36}$/i.test(c.uid)));
      check("concede XP", res.data.xpGained > 0, `xp=${res.data.xpGained}`);

      const { data: cards } = await admin.from("user_cards").select("uid, card_id").eq("user_id", alice.id);
      check("las cartas existen en la tabla user_cards", (cards ?? []).length === 5, `${cards?.length}`);

      const { data: packs } = await admin.from("user_packs")
        .select("qty").eq("user_id", alice.id).eq("pack_id", "inicial").maybeSingle();
      check("se ha consumido un sobre (3 → 2)", packs?.qty === 2, `qty=${packs?.qty}`);

      const { data: game } = await admin.from("user_game")
        .select("packs_opened").eq("user_id", alice.id).maybeSingle();
      check("packs_opened se incrementa en servidor", game?.packs_opened === 1);

      const { data: prof2 } = await admin.from("profiles").select("xp").eq("id", alice.id).maybeSingle();
      check("el XP del perfil refleja la apertura", Number(prof2?.xp) === res.data.xpGained);
    }
  }

  // ─────────────────────── Sobre inexistente / sin stock ───────────────────────
  console.log("\n## Validación de apertura");
  {
    const { openPackForUser } = await import("../src/server/services/packs");
    const noStock = await openPackForUser(admin, alice.id, "champions");
    check("no se puede abrir un sobre que no se posee", !noStock.ok && noStock.status === 409);
    const noPack = await openPackForUser(admin, alice.id, "no-existe");
    check("sobre inexistente devuelve 404", !noPack.ok && noPack.status === 404);
  }

  // ─────────────────────── TEST 3 ───────────────────────
  console.log("\n## TEST 3 · no se puede comprar un sobre sin saldo");
  {
    const { buyPack } = await import("../src/server/services/packs");

    // Vaciamos el saldo por la vía legítima (servidor).
    await admin.rpc("app_adjust_credits", {
      p_user: alice.id, p_delta: -6000, p_reason: "test_drain", p_ref: `drain:${alice.id}`,
    });
    const { data: broke } = await admin.from("profiles").select("credits").eq("id", alice.id).maybeSingle();
    check("saldo a 0 por la vía del servidor", Number(broke?.credits) === 0);

    const res = await buyPack(admin, alice.id, "premium"); // 2500 créditos
    check("la compra se rechaza por saldo insuficiente", !res.ok && res.status === 409,
      res.ok ? "compró igualmente" : res.error);

    const { data: after } = await admin.from("profiles").select("credits").eq("id", alice.id).maybeSingle();
    check("el saldo sigue a 0 (no queda negativo)", Number(after?.credits) === 0, `credits=${after?.credits}`);

    const { data: pk } = await admin.from("user_packs")
      .select("qty").eq("user_id", alice.id).eq("pack_id", "premium").maybeSingle();
    check("no se ha añadido el sobre", !pk || pk.qty === 0);
  }

  // ─────────────────────── Compra correcta + idempotencia ───────────────────────
  console.log("\n## Compra con saldo e idempotencia");
  {
    const { buyPack } = await import("../src/server/services/packs");
    await admin.rpc("app_adjust_credits", {
      p_user: alice.id, p_delta: 5000, p_reason: "test_topup", p_ref: `topup:${alice.id}`,
    });

    const ref = `buy-test:${alice.id}`;
    const first = await buyPack(admin, alice.id, "estandar", ref);  // 750
    check("la compra con saldo funciona", first.ok);
    const { data: c1 } = await admin.from("profiles").select("credits").eq("id", alice.id).maybeSingle();
    check("se ha cobrado el precio del catálogo (5000 → 4250)", Number(c1?.credits) === 4250, `credits=${c1?.credits}`);

    const second = await buyPack(admin, alice.id, "estandar", ref); // MISMA ref
    check("reintentar con la misma ref no vuelve a cobrar", second.ok);
    const { data: c2 } = await admin.from("profiles").select("credits").eq("id", alice.id).maybeSingle();
    check("el saldo no se ha movido en el reintento", Number(c2?.credits) === 4250, `credits=${c2?.credits}`);
  }

  // ─────────────────────── TEST 12 ───────────────────────
  console.log("\n## TEST 12 · el usuario A no puede tocar los datos del usuario B");
  const bob = await makeUser("bob");
  created.push(bob.id);
  {
    const { error: profErr } = await alice.client.from("profiles")
      .update({ avatar: "💀" }).eq("id", bob.id);
    const { data: bobProf } = await admin.from("profiles").select("avatar").eq("id", bob.id).maybeSingle();
    check("no puede cambiar el avatar de otro usuario", bobProf?.avatar === "🎮",
      profErr ? "rechazado" : `avatar=${bobProf?.avatar}`);

    const { data: bobCards } = await alice.client.from("user_cards").select("uid").eq("user_id", bob.id);
    check("no puede LEER el inventario de otro usuario", (bobCards ?? []).length === 0);

    const { data: bobLedger } = await alice.client.from("credit_transactions").select("id").eq("user_id", bob.id);
    check("no puede LEER el libro mayor de otro usuario", (bobLedger ?? []).length === 0);

    const { data: bobPacks } = await alice.client.from("user_packs").select("pack_id").eq("user_id", bob.id);
    check("no puede LEER los sobres de otro usuario", (bobPacks ?? []).length === 0);

    // Y sí puede leer LO SUYO (si no, habríamos roto el producto).
    const { data: own } = await alice.client.from("user_cards").select("uid").eq("user_id", alice.id);
    check("sí puede leer su propio inventario", (own ?? []).length === 5, `${own?.length}`);
  }

  // ─────────────────────── Seriales globales ───────────────────────
  console.log("\n## Integridad de seriales");
  {
    const { data: dup } = await admin.rpc("app_grant_cards", {
      p_user: bob.id,
      p_instances: [{ cardId: "derke__champions-mvp", serial: 1, origin: "reward" }],
      p_mint_delta: { "derke__champions-mvp": 1 },
      p_origin: "reward",
    });
    check("el servidor puede conceder una carta con serial", !!dup);

    const again = await admin.rpc("app_grant_cards", {
      p_user: alice.id,
      p_instances: [{ cardId: "derke__champions-mvp", serial: 1, origin: "reward" }],
      p_mint_delta: {},
      p_origin: "reward",
    });
    check("el mismo nº de serie NO puede existir dos veces en la plataforma", !!again.error,
      again.error?.message?.slice(0, 60));
  }

  console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
}

main()
  .catch((e) => { console.error("\n💥 Error inesperado:", e); failures++; })
  .finally(async () => {
    // Limpieza: los usuarios de prueba no se quedan en la base de datos.
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
    process.exit(failures === 0 ? 0 : 1);
  });
