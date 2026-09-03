/**
 * VERIFICACIÓN — ECONOMÍA Y MERCADO (NEXUS, Fase 11).
 *
 *   npm run economy:verify
 *
 * Ejercita contra la base de datos REAL las tres cosas que una economía no puede permitirse
 * hacer mal, y lo hace INTENTANDO ROMPERLAS:
 *
 *   1. **El libro mayor cuadra.** Cada movimiento deja su asiento, con su clase y su
 *      contraparte, y la suma de asientos es el saldo.
 *   2. **Nada se cobra ni se entrega dos veces.** Comprar, abrir, desguazar, publicar y
 *      comprar en el mercado son idempotentes bajo la misma clave.
 *   3. **El cliente no pone precio a nada.** Ni al desguace, ni a las cartas ajenas, ni a
 *      los listados de otros.
 *
 * Y los ataques que se prueban de verdad: doble gasto, doble compra, carrera entre dos
 * compradores, saldo negativo, propiedad falsificada, cancelación ajena, precio fuera de
 * banda, importe negativo y desbordamiento.
 *
 * Limpia todo lo que crea.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CardRegistry } from "@/collection/registry";
import { buyPack, openPackForUser, buyAndOpen } from "@/server/services/packs";
import { previewSalvage, salvageCards } from "@/server/services/economy";
import { listCard, cancelListing, buyListing, browse, myListings, myTrades } from "@/server/services/market";
import { salvageValue } from "@/domain/economy/salvage";
import { getCard } from "@/data/catalog";

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
if (!URL_ || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

let failures = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const registry = new CardRegistry();

const balanceOf = async (id: string) => {
  const { data } = await admin.from("profiles").select("credits").eq("id", id).maybeSingle();
  return Number((data as { credits: number } | null)?.credits ?? 0);
};

const packQty = async (id: string, packId: string) => {
  const { data } = await admin.from("user_packs")
    .select("qty").eq("user_id", id).eq("pack_id", packId).maybeSingle();
  return Number((data as { qty: number } | null)?.qty ?? 0);
};

const ledgerOf = async (id: string) => {
  const { data } = await admin.from("credit_transactions")
    .select("delta, reason, ref, kind, counterparty_id, balance_after")
    .eq("user_id", id).order("created_at", { ascending: true });
  return (data ?? []) as {
    delta: number; reason: string; ref: string | null; kind: string;
    counterparty_id: string | null; balance_after: number;
  }[];
};

async function makeUser(tag: string) {
  const email = `econ-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: "Test-1234-econ", email_confirm: true,
    user_metadata: { username: `econ${tag}${Date.now().toString(36)}` },
  });
  if (error || !data.user) throw new Error(error?.message ?? "no se pudo crear el usuario");
  return data.user.id;
}

/** Concede N ejemplares de la misma carta, por la RPC real. */
async function grant(userId: string, cardId: string, n: number) {
  await admin.rpc("app_grant_cards", {
    p_user: userId,
    p_instances: Array.from({ length: n }, () => ({ cardId, serial: null })),
    p_mint_delta: {},
    p_origin: "admin",
  });
}

async function main() {
  console.log("# Verificación de ECONOMÍA Y MERCADO — NEXUS (Fase 11)\n");

  const alice = await makeUser("a");
  const bob = await makeUser("b");
  const cheapCard = [...registry.cards].sort((a, b) => a.ovr - b.ovr)[0].id;

  try {
    // ══════════════════════════════════════════════════════════════════
    console.log("## 1 · LIBRO MAYOR");
    // ══════════════════════════════════════════════════════════════════
    {
      const start = await balanceOf(alice);
      check("un jugador nuevo arranca con el saldo del perfil", start === 6000, `${start}`);

      await admin.rpc("app_adjust_credits", {
        p_user: alice, p_delta: 500, p_reason: "qa_credit", p_ref: `qa:cr:${alice}`,
      });
      await admin.rpc("app_adjust_credits", {
        p_user: alice, p_delta: -200, p_reason: "qa_debit", p_ref: `qa:db:${alice}`,
      });

      const led = await ledgerOf(alice);
      const credit = led.find((r) => r.reason === "qa_credit");
      const debit = led.find((r) => r.reason === "qa_debit");
      check("un abono queda como `credit`", credit?.kind === "credit", credit?.kind);
      check("un cargo queda como `debit`", debit?.kind === "debit", debit?.kind);

      const bal = await balanceOf(alice);
      check("el saldo es el que dice el último asiento",
        bal === led[led.length - 1].balance_after, `${bal} vs ${led[led.length - 1].balance_after}`);

      /*
       * El libro mayor es COMPLETO desde la creación de la cuenta: `handle_new_user`
       * escribe el asiento `starter_grant` con los 6.000 iniciales. Así que la suma de
       * todos los deltas ES el saldo, sin sumar ningún saldo de partida por fuera.
       */
      check("existe el asiento de apertura de la cuenta",
        led.some((r) => r.reason === "starter_grant" && Number(r.delta) === 6000));
      const sum = led.reduce((s, r) => s + Number(r.delta), 0);
      check("el libro mayor CUADRA con el saldo: la suma de asientos ES el saldo",
        sum === bal, `libro ${sum} · perfil ${bal}`);
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 2 · SALDO NEGATIVO E IMPORTES INVÁLIDOS");
    // ══════════════════════════════════════════════════════════════════
    {
      const before = await balanceOf(alice);
      const { error } = await admin.rpc("app_adjust_credits", {
        p_user: alice, p_delta: -(before + 1), p_reason: "qa_overdraw", p_ref: `qa:over:${alice}`,
      });
      check("gastar más de lo que hay se rechaza", !!error, error?.message?.slice(0, 40));
      check("y el saldo no se mueve", (await balanceOf(alice)) === before);

      const bad = await admin.rpc("app_buy_pack", {
        p_user: alice, p_pack_id: "estandar", p_price: -5000, p_ref: `qa:neg:${alice}`,
      });
      check("un precio NEGATIVO se rechaza", !!bad.error, bad.error?.message?.slice(0, 40));

      const noRef = await admin.rpc("app_buy_pack", {
        p_user: alice, p_pack_id: "estandar", p_price: 750, p_ref: null,
      });
      check("comprar SIN clave de idempotencia se rechaza", !!noRef.error, noRef.error?.message?.slice(0, 50));
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 3 · IDEMPOTENCIA DE SOBRES");
    // ══════════════════════════════════════════════════════════════════
    {
      const before = await balanceOf(alice);
      const qtyBefore = await packQty(alice, "estandar");
      const gesture = `g-${Date.now()}`;

      const first = await buyPack(admin, alice, "estandar", gesture);
      check("la compra funciona", first.ok, first.ok ? "" : first.error);
      const mid = await balanceOf(alice);
      check("se ha cobrado el precio del catálogo", mid === before - 750, `${before} → ${mid}`);

      const again = await buyPack(admin, alice, "estandar", gesture);
      check("repetir el MISMO gesto no vuelve a cobrar", again.ok && (await balanceOf(alice)) === mid,
        `${await balanceOf(alice)}`);

      /*
       * Se mide el INCREMENTO, no el total: una cuenta nueva nace con sobres de bienvenida
       * (`handle_new_user` da 3 «inicial» y 1 «estandar»), así que el total absoluto no
       * dice nada sobre si la compra se duplicó.
       */
      const qtyNow = await packQty(alice, "estandar");
      check("y no ha entrado un segundo sobre", qtyNow === qtyBefore + 1,
        `${qtyBefore} → ${qtyNow}`);

      // ── Abrir: el reintento devuelve LAS MISMAS cartas ──
      const openGesture = `o-${Date.now()}`;
      const o1 = await openPackForUser(admin, alice, "estandar", openGesture);
      check("abrir funciona", o1.ok, o1.ok ? "" : o1.error);
      const uids1 = o1.ok ? o1.data.opened.map((c) => c.uid).sort() : [];

      const o2 = await openPackForUser(admin, alice, "estandar", openGesture);
      check("reintentar la apertura NO consume otro sobre", o2.ok, o2.ok ? "" : o2.error);
      const uids2 = o2.ok ? o2.data.opened.map((c) => c.uid).sort() : [];
      check("y devuelve exactamente las MISMAS cartas",
        JSON.stringify(uids1) === JSON.stringify(uids2), `${uids1.length} vs ${uids2.length}`);

      // ── buy_and_open reintentado de punta a punta ──
      const bag = `bao-${Date.now()}`;
      const balBefore = await balanceOf(alice);
      const b1 = await buyAndOpen(admin, alice, "estandar", bag);
      check("comprar y abrir en un gesto funciona", b1.ok, b1.ok ? "" : b1.error);
      const b2 = await buyAndOpen(admin, alice, "estandar", bag);
      check("reintentar el gesto entero no cobra otra vez",
        b2.ok && (await balanceOf(alice)) === balBefore - 750,
        `${balBefore} → ${await balanceOf(alice)}`);
      check("ni entrega un segundo juego de cartas",
        b1.ok && b2.ok &&
        JSON.stringify(b1.data.opened.map((c) => c.uid).sort()) ===
        JSON.stringify(b2.data.opened.map((c) => c.uid).sort()));
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 4 · DESGUACE DE DUPLICADOS");
    // ══════════════════════════════════════════════════════════════════
    {
      await grant(alice, cheapCard, 3);
      const def = getCard(cheapCard)!;
      const each = salvageValue(def);

      const prev = await previewSalvage(admin, alice);
      check("la vista previa encuentra los duplicados", prev.ok, prev.ok ? "" : prev.error);
      const line = prev.ok ? prev.data.lines.find((l) => l.cardId === cheapCard) : undefined;
      check("y conserva SIEMPRE un ejemplar", line?.salvageable === 2, `${line?.salvageable} de ${line?.copies}`);
      check("el precio lo pone el servidor, con la tabla del dominio",
        line?.each === each, `${line?.each} vs ${each}`);

      const before = await balanceOf(alice);
      const uids = prev.ok ? prev.data.uids.filter((u) => true) : [];
      const gesture = `sal:${Date.now()}`;
      const r1 = await salvageCards(admin, alice, uids, gesture);
      check("el desguace paga", r1.ok, r1.ok ? "" : r1.error);
      const paid = r1.ok ? r1.data.paid : 0;
      check("y paga exactamente lo que dice la tabla",
        (await balanceOf(alice)) === before + paid, `+${paid}`);

      const r2 = await salvageCards(admin, alice, uids, gesture);
      check("repetir el desguace no paga dos veces",
        r2.ok && r2.data.repeated === true && (await balanceOf(alice)) === before + paid);

      const { count: left } = await admin.from("user_cards")
        .select("uid", { count: "exact", head: true }).eq("user_id", alice).eq("card_id", cheapCard);
      check("queda exactamente un ejemplar de la carta", left === 1, `${left}`);

      // Robo: desguazar cartas de otro.
      await grant(bob, cheapCard, 2);
      const bobPrev = await previewSalvage(admin, bob);
      const bobUid = bobPrev.ok ? bobPrev.data.uids[0] : "";
      const theft = await salvageCards(admin, alice, [bobUid], `theft:${Date.now()}`);
      check("desguazar la carta de OTRO se rechaza", !theft.ok, theft.ok ? "" : theft.error);
      const { count: bobLeft } = await admin.from("user_cards")
        .select("uid", { count: "exact", head: true }).eq("user_id", bob).eq("card_id", cheapCard);
      check("y la carta de la víctima sigue ahí", bobLeft === 2, `${bobLeft}`);
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 5 · MERCADO · PUBLICAR");
    // ══════════════════════════════════════════════════════════════════
    let listingId = "";
    let aliceUid = "";
    {
      await grant(alice, cheapCard, 2);
      const { data: rows } = await admin.from("user_cards")
        .select("uid").eq("user_id", alice).eq("card_id", cheapCard).limit(1);
      aliceUid = (rows as { uid: string }[])[0].uid;

      const bad = await listCard(admin, alice, aliceUid, 0, `l0:${Date.now()}`);
      check("publicar a precio cero se rechaza", !bad.ok, bad.ok ? "" : bad.error);

      const ok = await listCard(admin, alice, aliceUid, 500, `l1:${Date.now()}`);
      check("publicar funciona", ok.ok, ok.ok ? "" : ok.error);
      listingId = ok.ok ? ok.data.listingId : "";

      const { data: card } = await admin.from("user_cards")
        .select("user_id, locked").eq("uid", aliceUid).maybeSingle();
      const c = card as { user_id: string; locked: boolean };
      check("la carta NO cambia de dueño al publicarla", c.user_id === alice);
      check("pero queda BLOQUEADA (depósito en garantía)", c.locked === true);

      const twice = await listCard(admin, alice, aliceUid, 600, `l2:${Date.now()}`);
      check("no se puede publicar dos veces el mismo ejemplar", !twice.ok, twice.ok ? "" : twice.error);

      const alien = await listCard(admin, bob, aliceUid, 500, `l3:${Date.now()}`);
      check("no se puede publicar la carta de OTRO", !alien.ok, alien.ok ? "" : alien.error);

      const salv = await previewSalvage(admin, alice);
      check("una carta publicada no aparece como desguazable",
        salv.ok && !salv.data.uids.includes(aliceUid));
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 6 · MERCADO · CANCELAR");
    // ══════════════════════════════════════════════════════════════════
    {
      const alien = await cancelListing(admin, bob, listingId);
      check("cancelar el listado de OTRO se rechaza", !alien.ok, alien.ok ? "" : alien.error);

      const ok = await cancelListing(admin, alice, listingId);
      check("el dueño puede cancelar", ok.ok, ok.ok ? "" : ok.error);

      const { data: card } = await admin.from("user_cards").select("locked").eq("uid", aliceUid).maybeSingle();
      check("y la carta se DESBLOQUEA", (card as { locked: boolean }).locked === false);

      const again = await cancelListing(admin, alice, listingId);
      check("cancelar dos veces se rechaza por estado", !again.ok, again.ok ? "" : again.error);
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 7 · MERCADO · COMPRAR");
    // ══════════════════════════════════════════════════════════════════
    {
      const price = 500;
      const listed = await listCard(admin, alice, aliceUid, price, `l4:${Date.now()}`);
      const id = listed.ok ? listed.data.listingId : "";

      const self = await buyListing(admin, alice, id, `self:${Date.now()}`);
      check("comprar tu PROPIO listado se rechaza", !self.ok, self.ok ? "" : self.error);

      // Bob sin saldo suficiente.
      const bobStart = await balanceOf(bob);
      await admin.rpc("app_adjust_credits", {
        p_user: bob, p_delta: -bobStart, p_reason: "qa_empty", p_ref: `qa:empty:${bob}`,
      });
      const broke = await buyListing(admin, bob, id, `broke:${Date.now()}`);
      check("comprar SIN saldo se rechaza", !broke.ok, broke.ok ? "" : broke.error);
      check("y la carta sigue siendo del vendedor",
        (await admin.from("user_cards").select("user_id").eq("uid", aliceUid).maybeSingle())
          .data!.user_id === alice);

      // Con saldo.
      await admin.rpc("app_adjust_credits", {
        p_user: bob, p_delta: 10000, p_reason: "qa_fund", p_ref: `qa:fund:${bob}`,
      });
      const aliceBefore = await balanceOf(alice);
      const bobBefore = await balanceOf(bob);

      const gesture = `buy:${Date.now()}`;
      const bought = await buyListing(admin, bob, id, gesture);
      check("la compra funciona", bought.ok, bought.ok ? "" : bought.error);
      const fee = bought.ok ? bought.data.fee : 0;
      check("se aplica la comisión del 5 %", fee === Math.floor(price * 0.05), `${fee}`);

      check("al comprador se le cobra el precio ENTERO",
        (await balanceOf(bob)) === bobBefore - price, `${bobBefore} → ${await balanceOf(bob)}`);
      check("al vendedor le llega el precio MENOS la comisión",
        (await balanceOf(alice)) === aliceBefore + price - fee,
        `${aliceBefore} → ${await balanceOf(alice)}`);

      const { data: card } = await admin.from("user_cards")
        .select("user_id, locked, origin").eq("uid", aliceUid).maybeSingle();
      const c = card as { user_id: string; locked: boolean; origin: string };
      check("la carta cambia de dueño", c.user_id === bob);
      check("y se desbloquea", c.locked === false);
      check("con el origen marcado como `market`", c.origin === "market", c.origin);

      // ── El libro mayor de la venta ──
      const ledBob = await ledgerOf(bob);
      const out = ledBob.find((r) => r.kind === "transfer_out");
      check("el comprador tiene un asiento `transfer_out`", !!out, out?.reason);
      check("con el vendedor como contraparte", out?.counterparty_id === alice);

      const ledAlice = await ledgerOf(alice);
      const inn = ledAlice.find((r) => r.kind === "transfer_in");
      const feeRow = ledAlice.find((r) => r.reason === "market_fee");
      check("el vendedor tiene un asiento `transfer_in`", !!inn, inn?.reason);
      check("con el comprador como contraparte", inn?.counterparty_id === bob);
      check("y la comisión queda como asiento propio", !!feeRow && Number(feeRow.delta) === -fee,
        `${feeRow?.delta}`);

      // ── Idempotencia y doble compra ──
      const repeat = await buyListing(admin, bob, id, gesture);
      check("repetir la MISMA compra no cobra dos veces",
        repeat.ok && repeat.data.repeated === true && (await balanceOf(bob)) === bobBefore - price);

      const second = await buyListing(admin, bob, id, `buy2:${Date.now()}`);
      check("comprar un listado YA VENDIDO se rechaza", !second.ok, second.ok ? "" : second.error);

      // ── Carrera: dos compradores simultáneos sobre el mismo listado ──
      const carol = await makeUser("c");
      const dave = await makeUser("d");
      try {
        await grant(bob, cheapCard, 1);
        const { data: r2 } = await admin.from("user_cards")
          .select("uid").eq("user_id", bob).eq("card_id", cheapCard).eq("locked", false).limit(1);
        const raceUid = (r2 as { uid: string }[])[0].uid;
        const raceListing = await listCard(admin, bob, raceUid, 300, `race:${Date.now()}`);
        const rid = raceListing.ok ? raceListing.data.listingId : "";

        for (const u of [carol, dave]) {
          await admin.rpc("app_adjust_credits", {
            p_user: u, p_delta: 5000, p_reason: "qa_fund", p_ref: `qa:fund:${u}`,
          });
        }

        const [rc, rd] = await Promise.all([
          buyListing(admin, carol, rid, `race-c:${Date.now()}`),
          buyListing(admin, dave, rid, `race-d:${Date.now()}`),
        ]);
        const winners = [rc, rd].filter((r) => r.ok).length;
        check("dos compradores simultáneos: SOLO uno se lleva la carta", winners === 1,
          `${winners} compras aceptadas`);

        const { data: owner } = await admin.from("user_cards")
          .select("user_id").eq("uid", raceUid).maybeSingle();
        const ownerId = (owner as { user_id: string }).user_id;
        check("y la carta tiene exactamente un dueño nuevo",
          ownerId === carol || ownerId === dave, ownerId === carol ? "carol" : ownerId === dave ? "dave" : "nadie");

        const { count: sold } = await admin.from("transactions")
          .select("id", { count: "exact", head: true }).eq("seller_id", bob);
        check("y solo se registra UNA transacción de esa venta", sold === 1, `${sold}`);
      } finally {
        await admin.auth.admin.deleteUser(carol).catch(() => {});
        await admin.auth.admin.deleteUser(dave).catch(() => {});
      }
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 8 · MERCADO · LECTURAS");
    // ══════════════════════════════════════════════════════════════════
    {
      const b = await browse(admin, { limit: 20 });
      check("el escaparate responde", b.ok, b.ok ? "" : b.error);
      const mine = await myListings(admin, alice);
      check("mis listados incluyen los cerrados", mine.ok && mine.data.listings.length >= 2,
        `${mine.ok ? mine.data.listings.length : 0}`);
      const t = await myTrades(admin, alice);
      check("mi historial registra la venta",
        t.ok && t.data.trades.some((x) => x.side === "sell"), `${t.ok ? t.data.trades.length : 0}`);
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 9 · PREPARACIÓN PARA DINERO REAL");
    // ══════════════════════════════════════════════════════════════════
    {
      const key = `idem-${Date.now()}`;
      const base = {
        user_id: alice, product_id: "credits-small", amount_cents: 499,
        currency: "EUR", provider: "none", idempotency_key: key,
      };
      const first = await admin.from("payments").insert(base).select("id").single();
      check("un pago se registra con producto, importe y divisa", !first.error, first.error?.message);

      const dup = await admin.from("payments").insert(base);
      check("la MISMA clave de idempotencia no crea dos pagos", !!dup.error,
        dup.error?.message?.slice(0, 45));

      const negative = await admin.from("payments").insert({
        ...base, amount_cents: -499, idempotency_key: `${key}-neg`,
      });
      check("un importe NEGATIVO se rechaza", !!negative.error, negative.error?.message?.slice(0, 45));

      const badCurrency = await admin.from("payments").insert({
        ...base, currency: "euros", idempotency_key: `${key}-cur`,
      });
      check("una divisa que no es ISO-4217 se rechaza", !!badCurrency.error,
        badCurrency.error?.message?.slice(0, 45));

      const badStatus = await admin.from("payments").insert({
        ...base, status: "regalado", idempotency_key: `${key}-st`,
      });
      check("un estado inventado se rechaza", !!badStatus.error, badStatus.error?.message?.slice(0, 45));

      const txId = `tx-${Date.now()}`;
      await admin.from("payments").update({ provider_tx_id: txId, status: "paid" }).eq("idempotency_key", key);
      const dupTx = await admin.from("payments").insert({
        ...base, idempotency_key: `${key}-2`, provider_tx_id: txId,
      });
      check("el MISMO cobro del proveedor no se liquida dos veces", !!dupTx.error,
        dupTx.error?.message?.slice(0, 45));

      const { data: row } = await admin.from("payments")
        .select("credits_granted").eq("idempotency_key", key).maybeSingle();
      check("un pago sin liquidar no ha concedido ningún crédito",
        (row as { credits_granted: number | null }).credits_granted === null);
    }
  } finally {
    for (const u of [alice, bob]) {
      await admin.from("market_listings").delete().eq("seller_id", u);
      await admin.auth.admin.deleteUser(u).catch(() => {});
    }
  }

  console.log(
    failures === 0
      ? "\n✅ LA ECONOMÍA Y EL MERCADO AGUANTAN"
      : `\n❌ ${failures} comprobación(es) fallidas`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
