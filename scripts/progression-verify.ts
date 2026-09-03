/**
 * VERIFICACIÓN DE LA PROGRESIÓN — Fase 9E.
 *
 *   npm run dev                 (en otra terminal)
 *   npm run progression:verify
 *
 * Comprueba contra la BASE DE DATOS y la API REALES lo que los tests unitarios no pueden:
 * que el servidor es de verdad la autoridad del pase, las misiones y los logros.
 *
 * Lo que se demuestra aquí:
 *   · Sin token no se responde nada.
 *   · El cliente NO puede escribir en `user_pass`, `user_achievements` ni `user_cosmetics`,
 *     ni siquiera en sus propias filas.
 *   · Un carril bloqueado no se reclama, por mucho que el cliente lo pida.
 *   · Un logro sin completar no se paga.
 *   · Reclamar dos veces no paga dos veces (idempotencia real, mirando el libro mayor).
 *   · El progreso NO viene del cliente: se recalcula de las tablas.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

import { masterySet } from "@/domain/collection/mastery";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✕"} ${label}${detail && !ok ? ` — ${detail}` : ""}`);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

/** Las cartas de un conjunto de maestría, desde el dominio: la prueba no las inventa. */
const MASTERY_CARDS = (setId: string): string[] => masterySet(setId)?.cardIds ?? [];

async function makeUser(tag: string) {
  const email = `prog-${tag}-${Date.now()}@example.invalid`;
  const password = "Test-1234-prog";
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `prog${tag}` },
  });
  if (error || !data.user) throw new Error(error?.message ?? "no se pudo crear el usuario");
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signin } = await pub.auth.signInWithPassword({ email, password });
  return { id: data.user.id, token: signin!.session!.access_token, pub };
}

async function api(token: string | null, body: unknown) {
  const res = await fetch(`${BASE}/api/game/progression`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Peticiones a la ruta de PRESTIGIO (Fase 14). */
async function prestige(token: string | null, body?: unknown) {
  const res = await fetch(`${BASE}/api/game/prestige`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** Peticiones a la ruta de MAESTRÍA (Fase 13). */
async function mastery(token: string | null, body?: unknown) {
  const res = await fetch(`${BASE}/api/game/mastery`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const creditsOf = async (userId: string): Promise<number> => {
  const { data } = await admin.from("profiles").select("credits").eq("id", userId).maybeSingle();
  return (data as { credits: number } | null)?.credits ?? 0;
};

/** Suma de créditos concedidos con un `ref` que empieza por un prefijo. */
async function ledgerFor(userId: string, prefix: string) {
  const { data } = await admin.from("credit_transactions")
    .select("ref, delta").eq("user_id", userId).like("ref", `${prefix}%`);
  const rows = (data ?? []) as { ref: string; delta: number }[];
  return { count: rows.length, total: rows.reduce((s, r) => s + r.delta, 0) };
}

async function main() {
  const ping = await fetch(`${BASE}/api/game/state`).catch(() => null);
  if (!ping || ping.status !== 401) {
    console.error(`❌ No hay servidor NEXUS en ${BASE}. Arranca 'npm run dev' primero.`);
    process.exit(1);
  }

  console.log(`# Verificación de progresión — ${BASE}\n`);

  const alice = await makeUser("a");
  const bob = await makeUser("b");

  try {
    // ── 1 · Autenticación ──
    console.log("## Autenticación");
    check((await api(null, { action: "state" })).status === 401, "sin token responde 401");
    check((await api("basura", { action: "state" })).status === 401, "con un token inventado responde 401");

    // ── 2 · Lectura del estado ──
    console.log("\n## Estado de la progresión");
    const st = await api(alice.token, { action: "state" });
    check(st.status === 200, "el estado se sirve al usuario autenticado", String(st.status));
    const view = st.json as Record<string, unknown>;
    /*
     * Nivel 0, no 1. Es la convención del motor (`levelProgress`): el nivel es el número
     * de tramos de XP COMPLETADOS, así que quien no ha jugado va por 0 y llega al 1 —el
     * primero con recompensa— al completar el primer tramo. Los carriles de la temporada
     * empiezan justo ahí, en el nivel 1.
     */
    check(view.level === 0, "un jugador nuevo va por el nivel 0, sin ningún tramo completado", String(view.level));
    check(view.premium === false, "el carril de pago empieza cerrado");
    check(view.competitiveUnlocked === false, "el carril competitivo empieza cerrado");
    check(Array.isArray(view.missions) && (view.missions as unknown[]).length > 0, "se le asignan misiones al entrar");
    check(Array.isArray(view.achievements) && (view.achievements as unknown[]).length > 0, "el catálogo de logros llega al cliente");

    // ── 3 · El cliente no escribe progreso ──
    console.log("\n## Autoridad: el cliente no escribe");
    const asAlice = createClient(URL_, ANON, {
      auth: { persistSession: false },
      global: { headers: { authorization: `Bearer ${alice.token}` } },
    });

    const wPass = await asAlice.from("user_pass")
      .upsert({ user_id: alice.id, season_id: "nexus-s1", state: { xp: 999999 } });
    check(!!wPass.error, "no puede escribir en `user_pass` ni en su propia fila", "el UPDATE pasó");

    const wAch = await asAlice.from("user_achievements")
      .insert({ user_id: alice.id, achievement_id: "sobres-1000" });
    check(!!wAch.error, "no puede insertarse un logro a mano", "el INSERT pasó");

    const wCos = await asAlice.from("user_cosmetics")
      .insert({ user_id: alice.id, cosmetic_id: "avatar:nexus-prime" });
    check(!!wCos.error, "no puede concederse un cosmético a mano", "el INSERT pasó");

    // Leer lo suyo sí puede: en su progreso no hay información oculta.
    const rPass = await asAlice.from("user_pass").select("user_id").eq("user_id", alice.id);
    check(!rPass.error, "sí puede LEER su propio pase", rPass.error?.message ?? "");

    // Lo de otro, no.
    const rOther = await asAlice.from("user_pass").select("user_id").eq("user_id", bob.id);
    check((rOther.data ?? []).length === 0, "no puede leer el pase de otro usuario");

    // ── 4 · Carriles bloqueados ──
    console.log("\n## Carriles bloqueados");
    const comp = await api(alice.token, { action: "claimLevel", level: 5, track: "competitive" });
    check(comp.status === 409, "el carril competitivo bloqueado rechaza el reclamo", String(comp.status));

    const prem = await api(alice.token, { action: "claimLevel", level: 1, track: "premium" });
    check(prem.status === 409, "el carril de pago bloqueado rechaza el reclamo", String(prem.status));

    const bad = await api(alice.token, { action: "claimLevel", level: 1, track: "regalado" });
    check(bad.status === 400, "un carril inventado se rechaza antes de llegar al servicio", String(bad.status));

    const high = await api(alice.token, { action: "claimLevel", level: 999, track: "free" });
    check(high.status === 400, "un nivel fuera de la temporada se rechaza", String(high.status));

    const unreached = await api(alice.token, { action: "claimLevel", level: 20, track: "free" });
    check(unreached.status === 409, "un nivel no alcanzado no se puede reclamar", String(unreached.status));

    // ── 5 · Logros ──
    console.log("\n## Logros");
    const notDone = await api(alice.token, { action: "claimAchievement", achievementId: "sobres-1000" });
    check(notDone.status === 409, "un logro sin completar no se paga", String(notDone.status));

    const noSuch = await api(alice.token, { action: "claimAchievement", achievementId: "inventado" });
    check(noSuch.status === 404, "un logro que no existe responde 404", String(noSuch.status));

    // ── 6 · Idempotencia con datos reales ──
    console.log("\n## Idempotencia");
    // Se le regala XP de pase por la vía del servidor para poder reclamar de verdad.
    await admin.from("user_pass").upsert({
      user_id: alice.id,
      season_id: "nexus-s1",
      state: {
        version: 1, seasonId: "nexus-s1", xp: 5000, premium: false, boost: 1, autoClaim: false,
        claimedFree: [], claimedCompetitive: [], claimedPremium: [], competitiveUnlocked: false,
        missions: [], missionsCompleted: 0, archive: [],
      },
    }, { onConflict: "user_id" });

    const first = await api(alice.token, { action: "claimLevel", level: 1, track: "free" });
    check(first.status === 200, "un nivel alcanzado sí se reclama", String(first.status));

    const second = await api(alice.token, { action: "claimLevel", level: 1, track: "free" });
    check(second.status === 409, "el mismo nivel no se reclama dos veces", String(second.status));

    const ledger = await ledgerFor(alice.id, "pass:nexus-s1:free:1");
    check(ledger.count === 1, "el libro mayor tiene UN solo asiento por ese nivel", `${ledger.count}`);

    // ── 7 · El progreso no lo dicta el cliente ──
    console.log("\n## El progreso se recalcula, no se acepta");
    const inflado = await api(alice.token, {
      action: "state", level: 30, xp: 999999, premium: true, competitiveUnlocked: true,
    });
    const v2 = inflado.json as Record<string, unknown>;
    check(v2.premium === false, "mandar `premium: true` en el cuerpo no abre el carril de pago");
    check(v2.competitiveUnlocked === false, "mandar `competitiveUnlocked: true` no abre el competitivo");
    check(
      typeof v2.points === "number" && v2.points === 0,
      "los puntos salen del perfil, no del cuerpo de la petición",
      String(v2.points),
    );

    // ── 8 · Aislamiento entre usuarios ──
    console.log("\n## Aislamiento");
    const bobState = await api(bob.token, { action: "state" });
    check((bobState.json as Record<string, unknown>).xp === 0, "el progreso de Alice no aparece en el de Bob");
    const bobLedger = await ledgerFor(bob.id, "pass:");
    check(bobLedger.count === 0, "a Bob no le ha llegado ninguna recompensa de Alice");

    // ── 9 · Maestría de colección (Fase 13) ──
    console.log("\n## Maestría de colección");
    {
      check((await mastery(null)).status === 401, "sin token responde 401");

      const view = await mastery(alice.token);
      check(view.status === 200, "la vista se sirve al usuario autenticado", String(view.status));
      const sets = (view.json.sets ?? []) as { id: string; total: number; tiers: { at: number }[] }[];
      check(sets.length > 0, "hay conjuntos de maestria", `${sets.length}`);

      // Un conjunto pequeño, para poder completarlo de verdad dentro de la prueba.
      const target = [...sets].sort((a, b) => a.total - b.total)[0];
      check(!!target, "hay un conjunto pequeno con el que probar");

      // Sin cartas no se cobra.
      const early = await mastery(alice.token, { action: "claim", setId: target.id, at: 1 });
      check(early.status === 409, "un conjunto sin completar NO se puede cobrar", String(early.status));

      // Identificadores invalidos.
      check((await mastery(alice.token, { action: "claim", setId: "no-existe", at: 1 })).status === 404,
        "un conjunto inventado responde 404");
      check((await mastery(alice.token, { action: "claim", setId: target.id, at: 0.31337 })).status === 404,
        "un escalon que no existe responde 404");
      check((await mastery(alice.token, { action: "claim", setId: target.id, at: 5 })).status === 400,
        "una fraccion fuera de rango responde 400");
      check((await mastery(alice.token, { action: "loquesea", setId: target.id, at: 1 })).status === 400,
        "una accion desconocida responde 400");

      /*
       * Y ahora completandolo de verdad: se conceden las cartas del conjunto con la RPC
       * real y se cobra. Es la unica forma de comprobar que el progreso lo cuenta el
       * servidor contra `user_cards` y no lo envia nadie.
       */
      const cardIds = MASTERY_CARDS(target.id);
      await admin.rpc("app_grant_cards", {
        p_user: alice.id,
        p_instances: cardIds.map((cardId) => ({ cardId, serial: null })),
        p_mint_delta: {},
        p_origin: "admin",
      });

      const before = await creditsOf(alice.id);
      const claim = await mastery(alice.token, { action: "claim", setId: target.id, at: 1 });
      check(claim.status === 200, "con el conjunto completo SI se cobra", String(claim.status) + " " + JSON.stringify(claim.json));

      /*
       * LA INVARIANTE ECONOMICA DE LA FASE 13, comprobada contra la base de datos: cobrar
       * maestria NO puede mover el saldo. Si lo moviera, habriamos resuelto el endgame
       * inflando la economia que la Fase 12 acababa de calibrar.
       */
      const after = await creditsOf(alice.id);
      check(after === before, "COBRAR MAESTRIA NO MUEVE NI UN CREDITO", `${before} -> ${after}`);

      const { data: cos } = await admin.from("user_cosmetics")
        .select("cosmetic_id").eq("user_id", alice.id).like("cosmetic_id", "insignia:%");
      check(((cos ?? []) as unknown[]).length > 0, "y si concede la insignia");

      const twice = await mastery(alice.token, { action: "claim", setId: target.id, at: 1 });
      check(twice.status === 409, "un segundo cobro se rechaza", String(twice.status));

      const led = await ledgerFor(alice.id, "mastery:");
      check(led.total === 0, "la maestria no deja ningun credito en el libro mayor", String(led.total));

      // ── 10 · Prestigio: EL SUMIDERO (Fase 14) ──
      console.log("\n## Prestigio (el sumidero de fin de juego)");

      check((await prestige(null)).status === 401, "sin token responde 401");

      const shop = await prestige(alice.token);
      check(shop.status === 200, "la vitrina se sirve al usuario autenticado", String(shop.status));
      const offers = (shop.json.offers ?? []) as { setId: string; tierId: string; price: number }[];
      check(offers.length > 0, "hay ofertas tras completar un conjunto", `${offers.length}`);
      check(offers.every((o) => o.tierId === "plata"),
        "todas las ofertas empiezan por el primer escalon", offers.map((o) => o.tierId).join(","));

      const offer = offers[0];

      // Identificadores invalidos.
      check((await prestige(alice.token, { action: "buy", setId: "no-existe", tierId: "plata" })).status === 404,
        "un conjunto inventado responde 404");
      check((await prestige(alice.token, { action: "buy", setId: offer.setId, tierId: "diamante" })).status === 404,
        "un escalon inventado responde 404");
      check((await prestige(alice.token, { action: "nope", setId: offer.setId, tierId: "plata" })).status === 400,
        "una accion desconocida responde 400");

      // Saltarse escalones.
      check((await prestige(alice.token, { action: "buy", setId: offer.setId, tierId: "elite" })).status === 409,
        "no se puede saltar al ultimo escalon");

      // Un conjunto sin completar no se puede prestigiar.
      const otro = (await mastery(alice.token)).json as { sets?: { id: string; owned: number; total: number }[] };
      const incompleto = (otro.sets ?? []).find((x) => x.owned < x.total);
      if (incompleto) {
        check((await prestige(alice.token, { action: "buy", setId: incompleto.id, tierId: "plata" })).status === 409,
          "un conjunto sin completar NO se puede prestigiar");
      }

      /*
       * SIN SALDO NO SE COMPRA, y sobre todo: el intento fallido no puede dejar el saldo
       * tocado. Se vacia la cuenta con la RPC real de ajuste antes de intentarlo.
       */
      const saldoPrevio = await creditsOf(alice.id);
      if (saldoPrevio > 0) {
        await admin.rpc("app_adjust_credits", {
          p_user: alice.id, p_delta: -saldoPrevio, p_reason: "qa_drain", p_ref: `qa-drain:${alice.id}`,
        });
      }
      const pobre = await prestige(alice.token, { action: "buy", setId: offer.setId, tierId: offer.tierId });
      check(pobre.status === 409, "sin saldo no se compra", String(pobre.status));
      check((await creditsOf(alice.id)) === 0, "y el intento fallido no ha tocado el saldo");

      // Con saldo justo: se compra y el saldo BAJA exactamente el precio.
      await admin.rpc("app_adjust_credits", {
        p_user: alice.id, p_delta: offer.price, p_reason: "qa_fund", p_ref: `qa-fund:${alice.id}`,
      });
      const antes = await creditsOf(alice.id);
      const compra = await prestige(alice.token, { action: "buy", setId: offer.setId, tierId: offer.tierId });
      check(compra.status === 200, "con saldo se compra", String(compra.status) + " " + JSON.stringify(compra.json));

      const despues = await creditsOf(alice.id);
      check(despues === antes - offer.price,
        "EL PRESTIGIO QUEMA CREDITOS: el saldo baja exactamente el precio",
        `${antes} -> ${despues} (precio ${offer.price})`);

      const ledPrest = await ledgerFor(alice.id, "prestige:");
      check(ledPrest.count === 1 && ledPrest.total === -offer.price,
        "y deja UN asiento NEGATIVO en el libro mayor",
        `${ledPrest.count} asiento(s), total ${ledPrest.total}`);

      const { data: bought } = await admin.from("user_cosmetics")
        .select("cosmetic_id, source").eq("user_id", alice.id).eq("source", "prestige");
      check(((bought ?? []) as unknown[]).length === 1, "el cosmetico mejorado es suyo");

      // Repetir la compra: ni se cobra ni se concede dos veces.
      const otraVez = await prestige(alice.token, { action: "buy", setId: offer.setId, tierId: offer.tierId });
      check(otraVez.status === 409, "una segunda compra del mismo escalon se rechaza", String(otraVez.status));
      check((await creditsOf(alice.id)) === despues, "y el saldo no se ha movido");

      // Y ahora la oferta de ese conjunto avanza al siguiente escalon.
      const shop2 = (await prestige(alice.token)).json as { offers?: { setId: string; tierId: string }[] };
      const nueva = (shop2.offers ?? []).find((o) => o.setId === offer.setId);
      check(nueva?.tierId === "oro", "la oferta avanza al escalon siguiente", nueva?.tierId ?? "ninguna");
    }
  } finally {
    await admin.auth.admin.deleteUser(alice.id).catch(() => {});
    await admin.auth.admin.deleteUser(bob.id).catch(() => {});
  }

  console.log(`\n${failures === 0 ? "✅ PASA" : `❌ ${failures} comprobaciones fallidas`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
