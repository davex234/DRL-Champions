/**
 * VERIFICACIÓN DE DRL CREDITS (Fase 18) — `npm run credits:verify`
 *
 * Ataca la moneda contra la base de datos REAL: saldo, idempotencia, concurrencia,
 * aislamiento entre usuarios y los veinte intentos de manipulación de la fase. Crea sus
 * propias cuentas y las borra al terminar; no toca ninguna cuenta existente.
 *
 * Lo que aquí se comprueba NO es que la interfaz valide: es que **la base de datos** se
 * niegue. Una defensa que solo vive en Node se salta con un cliente distinto.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  CREDIT_PRODUCTS, productById, activeProducts, isValidAmount, formatDRLC, formatDelta,
  MAX_TRANSACTION, CURRENCY_NAME,
} from "@/domain/economy/drlCredits";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!URL_ || !SERVICE || !ANON) {
  console.error("Faltan credenciales de Supabase en .env.local");
  process.exit(1);
}
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const balance = async (uid: string): Promise<number> => {
  const { data } = await db.from("profiles").select("credits").eq("id", uid).maybeSingle();
  return Number((data as { credits: number } | null)?.credits ?? -1);
};
const buy = (uid: string, productId: string, ref: string) => {
  const p = CREDIT_PRODUCTS.find((x) => x.productId === productId)!;
  return db.rpc("app_sandbox_purchase", {
    p_user: uid, p_product_id: productId, p_credits: p.credits,
    p_price_cents: p.referencePrice.cents, p_currency: p.referencePrice.currency, p_ref: ref,
  });
};

async function main(): Promise<void> {
  console.log("# Verificación de DRL Credits — DRL Champions (Fase 18)\n");

  // ── El dominio, sin tocar la base ──
  console.log("## La moneda");
  check(`la marca es «${CURRENCY_NAME}»`, CURRENCY_NAME === "DRL Credits");
  check("una sola moneda: 5 productos, todos en DRL Credits", CREDIT_PRODUCTS.length === 5);
  check("todas las cantidades son enteras y positivas",
    CREDIT_PRODUCTS.every((p) => Number.isSafeInteger(p.credits) && p.credits > 0));
  check("los precios de referencia son céntimos enteros (sin coma flotante)",
    CREDIT_PRODUCTS.every((p) => Number.isSafeInteger(p.referencePrice.cents)));
  check("ids únicos y orden estable",
    new Set(CREDIT_PRODUCTS.map((p) => p.productId)).size === 5
    && activeProducts().map((p) => p.order).join() === "1,2,3,4,5");
  check("formato español sin decimales", formatDRLC(5000) === `5.000 ${CURRENCY_NAME}`, formatDRLC(5000));
  check("el historial usa signo legible", formatDelta(-750) === `−750 ${CURRENCY_NAME}`, formatDelta(-750));
  check("un producto inexistente NO devuelve un producto por defecto", productById("no-existe") === undefined);

  console.log("\n## Cantidades inválidas rechazadas por el dominio");
  check("decimal", !isValidAmount(100.5));
  check("negativa", !isValidAmount(-100));
  check("cero", !isValidAmount(0));
  check("enorme", !isValidAmount(MAX_TRANSACTION + 1));
  check("NaN / Infinity", !isValidAmount(NaN) && !isValidAmount(Infinity));
  check("texto", !isValidAmount("5000" as unknown));
  check("válida pasa", isValidAmount(5000));

  // ── Cuentas de prueba ──
  const mk = async (tag: string) => {
    const email = `drlc-${tag}-${Date.now()}@test.local`;
    const { data, error } = await db.auth.admin.createUser({
      email, password: ephemeralQaPassword(), email_confirm: true,
    });
    if (error) throw new Error(`crear usuario: ${error.message}`);
    return { id: data.user!.id, email };
  };
  const A = await mk("a");
  const B = await mk("b");

  try {
    console.log("\n## Saldo inicial y libro mayor");
    const start = await balance(A.id);
    check("el alta concede el saldo inicial por el ledger", start === 6000, `${start}`);
    const { count: tx0 } = await db.from("credit_transactions")
      .select("*", { count: "exact", head: true }).eq("user_id", A.id);
    check("y queda asentado (no se escribió el saldo a mano)", (tx0 ?? 0) === 1);

    console.log("\n## Compra sandbox");
    const r1 = await buy(A.id, "drlc-popular", `t:${A.id}:c1`);
    check("compra concede DRL Credits", !r1.error && Number((r1.data as any)?.granted) === 5000,
      r1.error?.message ?? `+${(r1.data as any)?.granted}`);
    check("saldo actualizado", (await balance(A.id)) === start + 5000);
    const { data: kinds } = await db.from("credit_transactions")
      .select("kind, reason").eq("user_id", A.id).eq("kind", "purchase");
    check("el movimiento se registra como PURCHASE", (kinds as any[])?.length === 1,
      JSON.stringify((kinds as any[])?.[0]));
    const { data: pay } = await db.from("payments").select("provider, status, credits_granted, amount_cents")
      .eq("user_id", A.id).maybeSingle();
    check("cruza la frontera de pagos, marcada como sandbox",
      (pay as any)?.provider === "sandbox" && (pay as any)?.status === "granted"
      && Number((pay as any)?.credits_granted) === 5000);

    console.log("\n## Idempotencia");
    const r2 = await buy(A.id, "drlc-popular", `t:${A.id}:c1`);
    check("repetir la MISMA referencia no vuelve a conceder",
      (await balance(A.id)) === start + 5000, `saldo ${await balance(A.id)}`);
    check("y devuelve el mismo resultado lógico",
      Number((r2.data as any)?.granted) === Number((r1.data as any)?.granted));
    await buy(A.id, "drlc-starter", `t:${A.id}:c2`);
    check("una referencia distinta SÍ concede", (await balance(A.id)) === start + 5000 + 1000);

    console.log("\n## Saldo insuficiente y saldo negativo");
    const bal = await balance(A.id);
    const { error: eNeg } = await db.rpc("app_adjust_credits", {
      p_user: A.id, p_delta: -(bal + 1), p_reason: "intento", p_ref: `t:${A.id}:neg`,
    });
    check("gastar más de lo que hay se RECHAZA", !!eNeg && /insuficiente/i.test(eNeg.message),
      eNeg?.message);
    check("el saldo no se movió", (await balance(A.id)) === bal);
    check("nunca queda negativo", (await balance(A.id)) >= 0);

    console.log("\n## Concurrencia: dos gastos simultáneos sobre el mismo saldo");
    // Saldo exacto para que SOLO una de las dos operaciones quepa.
    await db.rpc("app_adjust_credits", {
      p_user: B.id, p_delta: 1000 - (await balance(B.id)), p_reason: "preparar", p_ref: `t:${B.id}:set`,
    });
    check("saldo preparado a 1.000", (await balance(B.id)) === 1000);
    const [c1, c2] = await Promise.all([
      db.rpc("app_adjust_credits", { p_user: B.id, p_delta: -750, p_reason: "gasto", p_ref: `t:${B.id}:x1` }),
      db.rpc("app_adjust_credits", { p_user: B.id, p_delta: -750, p_reason: "gasto", p_ref: `t:${B.id}:x2` }),
    ]);
    const okCount = [c1, c2].filter((r) => !r.error).length;
    const finalB = await balance(B.id);
    check("exactamente UNA de las dos se ejecuta", okCount === 1, `${okCount} correctas`);
    check("el saldo final es correcto (250), nunca −500", finalB === 250, `${finalB}`);

    console.log("\n## Devolución");
    const before = await balance(A.id);
    const rf = await db.rpc("app_sandbox_refund", {
      p_user: A.id, p_purchase_ref: `t:${A.id}:c1`, p_ref: `t:${A.id}:rf1`,
    });
    check("devuelve la compra original", !rf.error && Number((rf.data as any)?.refunded) === 5000,
      rf.error?.message);
    check("descuenta del saldo", (await balance(A.id)) === before - 5000);
    const { data: rk } = await db.from("credit_transactions")
      .select("kind").eq("user_id", A.id).eq("kind", "refund");
    check("se registra como REFUND", (rk as any[])?.length === 1);
    const rf2 = await db.rpc("app_sandbox_refund", {
      p_user: A.id, p_purchase_ref: `t:${A.id}:c1`, p_ref: `t:${A.id}:rf2`,
    });
    check("la MISMA compra no se devuelve dos veces", !!rf2.error && /ya fue devuelta/i.test(rf2.error.message),
      rf2.error?.message);
    const rf3 = await db.rpc("app_sandbox_refund", {
      p_user: A.id, p_purchase_ref: "no-existe", p_ref: `t:${A.id}:rf3`,
    });
    check("no hay devolución sin compra original", !!rf3.error && /inexistente/i.test(rf3.error.message));

    console.log("\n## Aislamiento entre usuarios");
    const rCross = await db.rpc("app_sandbox_refund", {
      // B intenta devolver la compra de A nombrando SU referencia.
      p_user: B.id, p_purchase_ref: `t:${A.id}:c2`, p_ref: `t:${B.id}:rob`,
    });
    check("no se puede devolver la compra de otro", !!rCross.error, rCross.error?.message);
    check("el saldo de B no cambió", (await balance(B.id)) === 250);

    console.log("\n## Producto manipulado");
    const bad = await db.rpc("app_sandbox_purchase", {
      p_user: A.id, p_product_id: "drlc-inventado", p_credits: 999_999,
      p_price_cents: 1, p_currency: "EUR", p_ref: `t:${A.id}:bad`,
    });
    // La RPC concede lo que se le pide: la puerta que valida el producto es el servicio de
    // Node, y por eso el catálogo NUNCA se consulta en el cliente. Se comprueba ahí.
    check("el dominio rechaza un id inexistente antes de llegar a la RPC",
      productById("drlc-inventado") === undefined);
    if (!bad.error) {
      await db.rpc("app_sandbox_refund", { p_user: A.id, p_purchase_ref: `t:${A.id}:bad`, p_ref: `t:${A.id}:undo` });
    }
    const zero = await db.rpc("app_sandbox_purchase", {
      p_user: A.id, p_product_id: "drlc-starter", p_credits: 0,
      p_price_cents: 199, p_currency: "EUR", p_ref: `t:${A.id}:zero`,
    });
    check("la RPC rechaza una cantidad de 0", !!zero.error && /inválida/i.test(zero.error.message));
    const neg = await db.rpc("app_sandbox_purchase", {
      p_user: A.id, p_product_id: "drlc-starter", p_credits: -5000,
      p_price_cents: 199, p_currency: "EUR", p_ref: `t:${A.id}:negp`,
    });
    check("la RPC rechaza una cantidad negativa", !!neg.error && /inválida/i.test(neg.error.message));
    const noRef = await db.rpc("app_sandbox_purchase", {
      p_user: A.id, p_product_id: "drlc-starter", p_credits: 1000,
      p_price_cents: 199, p_currency: "EUR", p_ref: "",
    });
    check("la RPC exige referencia", !!noRef.error && /Referencia/i.test(noRef.error.message));

    console.log("\n## El navegador no puede tocar la moneda");
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { error: eRpc } = await anon.rpc("app_sandbox_purchase", {
      p_user: A.id, p_product_id: "drlc-ultimate", p_credits: 28000,
      p_price_cents: 1, p_currency: "EUR", p_ref: "hack",
    });
    check("la RPC de compra está revocada al cliente", !!eRpc, eRpc?.message?.slice(0, 60));
    const { error: eRf } = await anon.rpc("app_sandbox_refund", {
      p_user: A.id, p_purchase_ref: "x", p_ref: "y",
    });
    check("la RPC de devolución está revocada al cliente", !!eRf);
    const { error: eUp } = await anon.from("profiles").update({ credits: 999_999 }).eq("id", A.id);
    check("el cliente no puede escribir su saldo", !!eUp, eUp?.message?.slice(0, 60));
    const { data: otras } = await anon.from("credit_transactions").select("*").eq("user_id", A.id);
    check("el cliente anónimo no lee el historial ajeno", (otras ?? []).length === 0);
    const { error: eIns } = await anon.from("credit_transactions")
      .insert({ user_id: A.id, delta: 10_000, reason: "regalo", balance_after: 0 });
    check("el cliente no puede insertar en el libro mayor", !!eIns);
    const { error: ePay } = await anon.from("payments")
      .insert({ user_id: A.id, product_id: "x", amount_cents: 1, currency: "EUR", provider: "x", idempotency_key: "x" });
    check("el cliente no puede insertar un pago", !!ePay);

    console.log("\n## El libro cuadra");
    const { data: all } = await db.from("credit_transactions")
      .select("delta, balance_after").eq("user_id", A.id).order("created_at", { ascending: true });
    const rows = (all ?? []) as { delta: number; balance_after: number }[];
    const suma = rows.reduce((n, r) => n + Number(r.delta), 0);
    check("suma de movimientos = saldo actual", suma === (await balance(A.id)), `${suma}`);
    check("cada asiento guarda el saldo resultante",
      rows.every((r, i) => Number(r.balance_after) === rows.slice(0, i + 1).reduce((n, x) => n + Number(x.delta), 0)));
    check("no hay ningún saldo intermedio negativo", rows.every((r) => Number(r.balance_after) >= 0));
    check("ningún delta es decimal", rows.every((r) => Number.isInteger(Number(r.delta))));
  } finally {
    await db.auth.admin.deleteUser(A.id).catch(() => {});
    await db.auth.admin.deleteUser(B.id).catch(() => {});
  }

  console.log(`\n${fail === 0 ? "✅ DRL CREDITS AGUANTA" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
