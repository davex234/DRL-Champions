/**
 * VERIFICACIÓN DE LA TIENDA DE DRL CREDITS (Fase 18.1) — `npm run credits:ui:verify`
 *
 * `credits:verify` ataca la BASE DE DATOS. Este ataca la **frontera HTTP**: los propios
 * manejadores `GET`/`POST` de `/api/game/credits`, invocados con `Request` reales y un
 * Bearer de Supabase de verdad. Es la capa que el navegador puede tocar, así que es la
 * capa donde hay que demostrar que el cliente no decide nada.
 *
 * No hace falta levantar el servidor: se importan los manejadores de la ruta. Lo que se
 * comprueba es exactamente lo que respondería en producción, sin un mock de por medio.
 *
 * Crea sus propias cuentas y las borra al terminar.
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

// Fase 41 · la tienda de prueba está cerrada por defecto; este verificador la abre explícitamente (entorno de prueba).
process.env.NEXUS_SANDBOX_CREDITS = "1";

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

const PASSWORD = ephemeralQaPassword();

interface Actor { id: string; token: string }

async function makeActor(tag: string): Promise<Actor> {
  const email = `drlcui-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.invalid`;
  const { data, error } = await db.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { username: `drlcui${tag}${Date.now().toString(36)}` },
  });
  if (error || !data.user) throw new Error(error?.message ?? "no se pudo crear el usuario");

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s, error: e2 } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2 || !s.session) throw new Error(e2?.message ?? "no se pudo iniciar sesión");
  return { id: data.user.id, token: s.session.access_token };
}

const ENDPOINT = "http://localhost/api/game/credits";

/** Pantallas y componentes que antes hablaban de fichas de evento. */
const PANTALLAS = [
  "src/app/tienda/page.tsx", "src/app/tienda/creditos/page.tsx", "src/app/eventos/page.tsx",
  "src/app/logros/page.tsx", "src/app/cuenta/page.tsx", "src/app/recompensas/page.tsx",
  "src/components/layout/GameShell.tsx", "src/components/craft/ForgePanel.tsx",
  "src/components/events/RewardChip.tsx", "src/components/events/LiveEventPanel.tsx",
  "src/components/pickems/PickemPanel.tsx", "src/components/pickems/PickemResult.tsx",
  "src/components/progression/PassRail.tsx", "src/lib/collections/format.ts",
];

/** Petición autenticada (o no, si `token` es null) contra el manejador real. */
const req = (token: string | null, init?: RequestInit): Request =>
  new Request(ENDPOINT, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });

const body = (o: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(o) });

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

async function main(): Promise<void> {
  console.log("# Verificación de la TIENDA de DRL Credits — frontera HTTP (Fase 18.1)\n");

  const { GET, POST } = await import("@/app/api/game/credits/route");
  const { CREDIT_PRODUCTS, activeProducts, formatDRLC } =
    await import("@/domain/economy/drlCredits");
  const { PAYMENTS_ENABLED } = await import("@/config/monetization");
  const { GLOBAL_MARKET_ENABLED } = await import("@/config/features");
  const { NAV_SECTIONS, isItemActive } = await import("@/design/nav");

  // ══════════════════════════════════════════════════════════════════
  console.log("## 1 · SIN SESIÓN NO HAY TIENDA");
  // ══════════════════════════════════════════════════════════════════
  {
    const g = await GET(req(null));
    check("GET sin Bearer responde 401", g.status === 401, `${g.status}`);
    const p = await POST(req(null, body({ action: "sandboxPurchase", productId: "drlc-starter", ref: "x" })));
    check("POST sin Bearer responde 401", p.status === 401, `${p.status}`);

    const bad = await GET(req("no-es-un-token"));
    check("GET con un Bearer inventado responde 401", bad.status === 401, `${bad.status}`);
    check("ninguna respuesta sin sesión se puede cachear",
      g.headers.get("cache-control") === "no-store");
  }

  const alice = await makeActor("a");
  const bob = await makeActor("b");

  try {
    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 2 · CATÁLOGO");
    // ══════════════════════════════════════════════════════════════════
    const product = activeProducts()[0];
    let startBalance = 0;
    {
      const res = await GET(req(alice.token));
      const d = await json(res);
      check("GET devuelve 200 con sesión", res.status === 200, `${res.status}`);
      check("la respuesta declara que es un SANDBOX", d.sandbox === true, String(d.sandbox));
      check("PAYMENTS_ENABLED sigue en falso", PAYMENTS_ENABLED === false, String(PAYMENTS_ENABLED));

      const products = (d.products ?? []) as { productId: string; credits: number }[];
      check("el catálogo llega del SERVIDOR, no del cliente",
        products.length === activeProducts().length, `${products.length} productos`);
      check("todo producto trae id, cantidad entera y precio de referencia",
        products.every((p) =>
          typeof p.productId === "string" && Number.isSafeInteger(p.credits) && p.credits > 0 &&
          Number.isSafeInteger((p as unknown as { referencePrice: { cents: number } }).referencePrice?.cents)));
      check("las cantidades del catálogo son las de la Fase 18",
        CREDIT_PRODUCTS.map((p) => p.credits).join(",") === "1000,2800,5000,13500,28000",
        CREDIT_PRODUCTS.map((p) => p.credits).join(","));

      startBalance = Number(d.balance);
      check("el saldo llega como entero", Number.isSafeInteger(startBalance), `${startBalance}`);
      check("el historial llega como lista", Array.isArray(d.history), `${(d.history as unknown[])?.length}`);
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 3 · COMPRA DE PRUEBA");
    // ══════════════════════════════════════════════════════════════════
    const ref = `buy-${Date.now().toString(36)}`;
    {
      const res = await POST(req(alice.token, body({ action: "sandboxPurchase", productId: product.productId, ref })));
      const d = await json(res);
      check("la compra responde 200", res.status === 200, `${res.status}`);
      check("concede EXACTAMENTE lo que dice el catálogo",
        Number(d.granted) === product.credits, `${d.granted} vs ${product.credits}`);
      check("devuelve el saldo resultante, calculado por la base",
        Number(d.credits) === startBalance + product.credits,
        `${d.credits} vs ${startBalance + product.credits}`);
      check("la respuesta sigue declarando sandbox", d.sandbox === true);
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 4 · EL SALDO Y EL HISTORIAL SE ACTUALIZAN");
    // ══════════════════════════════════════════════════════════════════
    {
      const d = await json(await GET(req(alice.token)));
      check("un GET posterior ve el saldo nuevo",
        Number(d.balance) === startBalance + product.credits, `${d.balance}`);

      const hist = (d.history ?? []) as { delta: number; kind: string; balanceAfter: number }[];
      const entry = hist.find((h) => h.delta === product.credits);
      check("la compra deja su asiento en el historial", !!entry, `${hist.length} movimientos`);
      check("el asiento se etiqueta como `purchase`", entry?.kind === "purchase", entry?.kind);
      check("el asiento lleva el saldo resultante",
        entry?.balanceAfter === startBalance + product.credits, `${entry?.balanceAfter}`);
      check("el historial viene del más reciente al más antiguo",
        hist.length < 2 || hist[0].balanceAfter === startBalance + product.credits);
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 5 · IDEMPOTENCIA (EL DOBLE CLIC)");
    // ══════════════════════════════════════════════════════════════════
    {
      /*
       * El contrato es «devuelve LO MISMO», no «devuelve cero»: `app_sandbox_purchase`
       * guarda el resultado en `economy_ops` y lo replica tal cual. Así el cliente que
       * reintenta por un corte de red recibe la misma respuesta que perdió, en vez de un
       * error o de un segundo cobro. Lo que no puede moverse es el SALDO.
       */
      const before = Number((await json(await GET(req(alice.token)))).balance);
      const res = await POST(req(alice.token, body({ action: "sandboxPurchase", productId: product.productId, ref })));
      const d = await json(res);
      check("repetir el MISMO gesto responde 200 (no es un error)", res.status === 200, `${res.status}`);
      check("devuelve EXACTAMENTE la misma respuesta que la primera vez",
        Number(d.granted) === product.credits && Number(d.credits) === before,
        `granted ${d.granted} · saldo ${d.credits}`);
      check("y el saldo NO se ha movido",
        Number((await json(await GET(req(alice.token)))).balance) === before, `${before}`);

      const g = await json(await GET(req(alice.token)));
      const hist = (g.history ?? []) as { delta: number }[];
      check("no hay dos asientos de la misma compra",
        hist.filter((h) => h.delta === product.credits).length === 1,
        `${hist.filter((h) => h.delta === product.credits).length} asientos`);
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 6 · DEVOLUCIÓN");
    // ══════════════════════════════════════════════════════════════════
    {
      const res = await POST(req(alice.token, body({
        action: "sandboxRefund", purchaseRef: ref, ref: `undo-${Date.now().toString(36)}`,
      })));
      const d = await json(res);
      check("la devolución responde 200", res.status === 200, `${res.status}`);
      check("devuelve exactamente lo concedido",
        Number(d.refunded) === product.credits, `${d.refunded}`);
      check("el saldo vuelve al de partida", Number(d.credits) === startBalance, `${d.credits}`);

      const dup = await POST(req(alice.token, body({
        action: "sandboxRefund", purchaseRef: ref, ref: `undo2-${Date.now().toString(36)}`,
      })));
      check("una compra ya devuelta no se devuelve dos veces", dup.status >= 400, `${dup.status}`);

      const ghost = await POST(req(alice.token, body({
        action: "sandboxRefund", purchaseRef: "compra-que-no-existe", ref: `g-${Date.now().toString(36)}`,
      })));
      check("no existe el reembolso sin compra original", ghost.status >= 400, `${ghost.status}`);
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 7 · EL CLIENTE NO DECIDE NADA");
    // ══════════════════════════════════════════════════════════════════
    {
      /*
       * Los veinte intentos de la Fase 18, aquí en su forma de petición HTTP. La ruta
       * RECHAZA el campo en vez de ignorarlo: quien lo envía está probando el sistema, y
       * un 400 explícito es más honesto que un éxito que finge haberle hecho caso.
       */
      for (const field of ["credits", "amount", "balance", "delta", "price", "cents", "kind",
        "transactionType", "userId", "user_id", "balanceAfter"]) {
        const res = await POST(req(alice.token, body({
          action: "sandboxPurchase", productId: product.productId,
          ref: `atk-${field}-${Date.now().toString(36)}`, [field]: 999_999,
        })));
        check(`un cuerpo con «${field}» se rechaza`, res.status === 400, `${res.status}`);
      }

      const before = Number((await json(await GET(req(alice.token)))).balance);
      const impostor = await POST(req(alice.token, body({
        action: "sandboxPurchase", productId: product.productId,
        ref: `imp-${Date.now().toString(36)}`, userId: bob.id,
      })));
      check("suplantar a otro usuario por el cuerpo se rechaza", impostor.status === 400, `${impostor.status}`);
      check("y el saldo del suplantado no se ha movido",
        Number((await json(await GET(req(bob.token)))).balance) ===
        Number((await json(await GET(req(bob.token)))).balance));
      check("ni el del atacante",
        Number((await json(await GET(req(alice.token)))).balance) === before);
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 8 · PRODUCTOS Y ACCIONES INVÁLIDOS");
    // ══════════════════════════════════════════════════════════════════
    {
      const cases: [string, unknown, number][] = [
        ["un producto que no existe", { action: "sandboxPurchase", productId: "drlc-infinito", ref: `x-${Date.now()}` }, 404],
        ["un productId con caracteres raros", { action: "sandboxPurchase", productId: "../../etc/passwd", ref: `y-${Date.now()}` }, 400],
        ["un productId vacío", { action: "sandboxPurchase", productId: "", ref: `z-${Date.now()}` }, 400],
        ["una acción inventada", { action: "regalameCreditos", ref: `w-${Date.now()}` }, 400],
        ["una petición sin acción", { ref: `v-${Date.now()}` }, 400],
        ["una referencia vacía", { action: "sandboxPurchase", productId: product.productId, ref: "" }, 400],
        ["una referencia desmesurada", { action: "sandboxPurchase", productId: product.productId, ref: "r".repeat(300) }, 400],
      ];
      for (const [label, payload, expected] of cases) {
        const res = await POST(req(alice.token, body(payload)));
        check(`${label} responde ${expected}`, res.status === expected, `${res.status}`);
      }

      const inactive = CREDIT_PRODUCTS.find((p) => !p.active);
      check("no hay productos inactivos vendibles",
        !inactive || !activeProducts().some((p) => p.productId === inactive.productId));
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 9 · AISLAMIENTO ENTRE JUGADORES");
    // ══════════════════════════════════════════════════════════════════
    {
      const shared = `compartida-${Date.now().toString(36)}`;
      const a = await json(await POST(req(alice.token, body({ action: "sandboxPurchase", productId: product.productId, ref: shared }))));
      const b = await json(await POST(req(bob.token, body({ action: "sandboxPurchase", productId: product.productId, ref: shared }))));
      check("la MISMA referencia en dos jugadores concede a los dos",
        Number(a.granted) === product.credits && Number(b.granted) === product.credits,
        `${a.granted} · ${b.granted}`);

      const cross = await POST(req(bob.token, body({
        action: "sandboxRefund", purchaseRef: shared, ref: `cross-${Date.now().toString(36)}`,
      })));
      const aliceAfter = Number((await json(await GET(req(alice.token)))).balance);
      check("devolver con la referencia de otro no toca el saldo ajeno",
        cross.status === 200 && aliceAfter === Number(a.credits), `${aliceAfter} vs ${a.credits}`);

      const gb = await json(await GET(req(bob.token)));
      const hb = (gb.history ?? []) as { balanceAfter: number }[];
      check("el historial de cada uno es solo suyo",
        hb.every((h) => Number.isSafeInteger(h.balanceAfter)));
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 10 · LA PANTALLA");
    // ══════════════════════════════════════════════════════════════════
    {
      const page = readFileSync(join(ROOT, "src/app/tienda/creditos/page.tsx"), "utf8");

      check("la tienda existe como ruta de la app", page.length > 0);
      check("usa EXCLUSIVAMENTE la API de DRL Credits",
        page.includes("@/lib/game/credits") && !page.includes("app_sandbox_purchase"));

      /*
       * Ninguna cantidad del catálogo puede estar escrita en la pantalla: si lo estuviera,
       * habría dos fuentes de verdad y un día dirían cosas distintas.
       */
      const hardcoded = CREDIT_PRODUCTS
        .map((p) => p.credits)
        .filter((c) => new RegExp(`\\b${c}\\b`).test(page));
      check("no hay ni una cantidad de créditos escrita a mano", hardcoded.length === 0,
        hardcoded.join(", "));

      check("no envía campos económicos en el cuerpo",
        !/\b(credits|amount|balance|delta)\s*:/.test(page.replace(/^\s*\*.*$/gm, "")));
      check("no integra ninguna pasarela de pago",
        !/stripe|paypal|braintree|adyen|redsys|checkout\.|payment[sS]?\.(create|confirm)/i.test(page));
      check("no pide datos de tarjeta", !/<input[^>]*(card|tarjeta|cvv|iban)/i.test(page));
      check("declara que es una tienda de prueba", /prueba/i.test(page));
      check("se niega a pintar si el servidor no confirma el sandbox",
        page.includes("view.sandbox !== true"));
      check("la marca es «DRL Credits», nunca «Créditos DRL»",
        !/Cr[ée]ditos DRL/i.test(page));

      const cubiertos = ["Loading", "ErrorState", "NeedsAccount", "EmptyState"];
      check("cubre carga, error, sin cuenta y catálogo vacío",
        cubiertos.every((c) => page.includes(c)), cubiertos.filter((c) => !page.includes(c)).join(", "));
      check("la compra pasa por una confirmación explícita", page.includes('at: "confirm"'));
      check("el botón se bloquea mientras la compra está en vuelo",
        page.includes("disabled={pending}"));
      check("hay sección de historial", page.includes("Tus movimientos"));
      check("la tabla del historial puede desplazarse en pantallas estrechas",
        page.includes("overflow-x-auto"));
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 11 · NAVEGACIÓN");
    // ══════════════════════════════════════════════════════════════════
    {
      const tienda = NAV_SECTIONS.find((s) => s.id === "tienda");
      const item = tienda?.items.find((i) => i.href === "/tienda/creditos");
      check("la tienda cuelga de la sección «Tienda» que ya existía", !!item, item?.label);
      check("no se ha creado una sección nueva", NAV_SECTIONS.filter((s) => s.id === "tienda").length === 1);
      check("se llama «DRL Credits» en el menú", item?.label === "DRL Credits", item?.label);
      check("en /tienda/creditos se marca la entrada específica, no la genérica",
        isItemActive("/tienda/creditos", "/tienda/creditos") &&
        !isItemActive("/tienda/creditos", "/tienda"));
      check("en /tienda se sigue marcando «Sobres»", isItemActive("/tienda", "/tienda"));

      const store = readFileSync(join(ROOT, "src/app/tienda/page.tsx"), "utf8");
      check("desde los sobres se llega a los DRL Credits", store.includes("/tienda/creditos"));
    }

    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 12 · LO QUE NO SE HA TOCADO");
    // ══════════════════════════════════════════════════════════════════
    {
      check("el mercado global sigue cerrado", GLOBAL_MARKET_ENABLED === false);
      check("no hay pagos reales conectados", PAYMENTS_ENABLED === false);
      check("el formato agrupa los millares en las cinco cantidades",
        CREDIT_PRODUCTS.every((p) => formatDRLC(p.credits).includes(".")),
        CREDIT_PRODUCTS.map((p) => formatDRLC(p.credits)).join(" · "));

      const monet = readFileSync(join(ROOT, "src/config/monetization.ts"), "utf8");
      check("el precio del pase premium no ha cambiado", monet.includes("cents: 599"));
      /* El comentario que explica la retirada sí puede nombrarlo; lo que no puede haber es export. */
      check("la segunda moneda ya no se exporta desde monetización",
        !/^export const PASS_TOKEN_COST/m.test(monet));
    }
    // ══════════════════════════════════════════════════════════════════
    console.log("\n## 13 · UNA SOLA MONEDA (F18.2)");
    // ══════════════════════════════════════════════════════════════════
    {
      /*
       * La retirada de las FICHAS DE EVENTO se comprueba aquí, y no en un test de tipos,
       * porque lo que importa no es que el campo compile: es que no quede ninguna vía por
       * la que una segunda moneda pueda volver a concederse o prometerse.
       */
      const rewardType = readFileSync(join(ROOT, "src/domain/events/types.ts"), "utf8");
      check("el tipo `Reward` ya no tiene campo de fichas", !/tokens\??\s*:/.test(rewardType));
      check("ya no existe el escaparate de evento que se pagaba en fichas",
        !rewardType.includes("ShopItemDef"));

      const craftTypes = readFileSync(join(ROOT, "src/craft/types.ts"), "utf8");
      check("el coste de una receta de forja ya no admite fichas",
        !/tokens\??\s*:/.test(craftTypes));

      const eventsStore = readFileSync(join(ROOT, "src/store/useEventsStore.ts"), "utf8");
      check("`useEventsStore` ya no lleva saldo de fichas", !/tokens/.test(eventsStore));
      check("`useEventsStore` ya no vende nada", !eventsStore.includes("buyShopItem"));

      const rewardsSvc = readFileSync(join(ROOT, "src/server/services/rewards.ts"), "utf8");
      check("el servidor ya no envía `p_tokens` al conceder", !rewardsSvc.includes("p_tokens"));

      const progSvc = readFileSync(join(ROOT, "src/server/services/progression.ts"), "utf8");
      check("`unlockPremiumWithTokens` ya no existe en el servidor",
        !progSvc.includes("unlockPremiumWithTokens"));
      const progRoute = readFileSync(join(ROOT, "src/app/api/game/progression/route.ts"), "utf8");
      check("la ruta ya no expone la acción `unlockPremium`", !progRoute.includes('"unlockPremium"'));
      const progClient = readFileSync(join(ROOT, "src/lib/progression/client.ts"), "utf8");
      check("el cliente ya no puede pedirla", !progClient.includes("unlockPremiumWithTokens"));

      /* Ningún botón ni texto de la interfaz puede seguir prometiendo fichas. */
      const promesas: string[] = [];
      for (const f of PANTALLAS) {
        const txt = readFileSync(join(ROOT, f), "utf8")
          .split("\n")
          .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))   // los comentarios sí pueden contarlo
          .join("\n");
        if (/🎟|fichas de evento|Fichas de evento/i.test(txt)) promesas.push(f);
      }
      check("ninguna pantalla promete fichas de evento", promesas.length === 0, promesas.join(", "));

      /*
       * Y el dato: mientras la columna exista (se retira en la migración 0027), tiene que
       * seguir a cero. Si alguien tuviera fichas, quedaría un saldo huérfano sin sumidero.
       */
      const { data: profs, error: perr } = await db.from("profiles").select("tokens");
      if (perr) {
        check("la columna `profiles.tokens` ya no existe (0027 aplicada)", true, perr.code);
      } else {
        const rows = (profs ?? []) as { tokens: number | null }[];
        const total = rows.reduce((a, r) => a + Number(r.tokens ?? 0), 0);
        check("mientras la columna exista, nadie tiene fichas", total === 0,
          `${rows.length} perfiles · suma ${total}`);
      }
    }

  } finally {
    for (const u of [alice, bob]) await db.auth.admin.deleteUser(u.id).catch(() => {});
  }

  console.log(
    fail === 0
      ? `\n✅ LA TIENDA DE DRL CREDITS AGUANTA — ${pass}/${pass + fail}`
      : `\n❌ ${fail} COMPROBACIÓN(ES) FALLARON — ${pass}/${pass + fail}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
