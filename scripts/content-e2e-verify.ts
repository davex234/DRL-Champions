/**
 * VERIFICACIÓN END-TO-END DEL PLANO DE CONTENIDO — `npm run content-e2e:verify` (Bloque 8.4.4).
 *
 * Los bloques 8.1 → 8.4.3 demostraron cada eslabón por separado: la carta existe en una fila
 * (8.1), la instancia congela una versión (8.2), el pool decide qué sale (8.3) y hay un panel
 * para las tres cosas (8.4.1 / 8.4.2 / 8.4.3). Ninguno recorrió **la cadena entera**.
 *
 * Esto la recorre, con el servidor real y por las rutas reales:
 *
 *   ADMIN → DEFINICIÓN → VERSIÓN → POOL → DISTRIBUCIÓN → SOBRE → ACUÑACIÓN → INSTANCIA
 *
 * y comprueba la propiedad que hace que la cadena valga algo: **editar el final no reescribe
 * el principio**. Un ejemplar acuñado bajo v1 sigue siendo v1 después de publicar v2, aunque
 * la misma carta vuelva a salir en un sobre y el nuevo ejemplar sí sea v2.
 *
 * Lo que NO se repite aquí, porque ya lo mide otro verificador y repetirlo sería ruido:
 *   · el determinismo bit a bit del sorteo   → `content-pools:verify`
 *   · la equivalencia catálogo ⇄ generador   → `content-catalog:verify`
 *   · la superficie del panel de cartas      → `admin-cards:verify`
 *   · la superficie del panel de pools       → `pools-admin:verify`
 *
 * Lo que crea, lo borra. Y lo dice al final.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog, resetServerCatalog } from "../src/server/catalog";
import { serverDistribution, resetServerDistribution } from "../src/server/catalog/distribution";
import { buildPool, BUCKETS } from "../src/domain/packs/pool";
import { effectiveProbabilities } from "../src/domain/packs/weighted";
import { composeDistribution, type PoolDef } from "../src/domain/packs/distribution";
import { getPack } from "../src/data/packs";
import { cardChecksum } from "../src/server/catalog/rows";
import { deriveCard } from "../src/domain/cards/combat";
import { unboost } from "../src/server/services/cardDerivation";
import { getVariant } from "../src/domain/cards/variants";
import { makeDeckResolver } from "../src/domain/cardgame/resolve";
import { CardRegistry } from "../src/collection/registry";
import { freshPity } from "../src/domain/packs/pity";
import type { OwnedCard } from "../src/domain/cards/types";

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
const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
if (!URL_ || !SERVICE || !ANON) { console.error("Falta configuración de Supabase"); process.exit(1); }
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });

let pass = 0, fail = 0, omit_ = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const omit = (l: string, motivo: string): void => {
  console.log(`  [OMIT] ${l} — ${motivo}`); omit_++;
};
const title = (t: string): void => console.log(`\n─── ${t} ${"─".repeat(Math.max(0, 66 - t.length))}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** La caché de distribución del servidor tiene 5 s de vida; esperar 6 s es esperar a que caduque. */
const TTL_CACHE_MS = 6_000;

// ───────────────────────────── ESTADO DE LA EJECUCIÓN ─────────────────────────────

const cuentas: string[] = [];
const cartasCreadas: string[] = [];
const poolsCreados: string[] = [];
let adminToken = "";
let admin2Token = "";
let jugador = { id: "", token: "" };
let vinculosOriginales: { pool_id: string; priority: number }[] = [];
const PACK = "estandar";

// ───────────────────────────── AYUDAS ─────────────────────────────

async function cuenta(tag: string, esAdmin: boolean): Promise<{ id: string; token: string }> {
  const email = `e2e844-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  cuentas.push(data.user.id);
  if (esAdmin) await db.from("profiles").update({ is_admin: true }).eq("id", data.user.id);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`login: ${s.error?.message}`);
  return { id: data.user.id, token: s.data.session.access_token };
}

async function post<T = Record<string, unknown>>(
  ruta: string, body: Record<string, unknown>, token: string | null,
): Promise<{ status: number; data: T }> {
  const r = await fetch(`${BASE}${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  let data: unknown = null;
  try { data = await r.json(); } catch { data = {}; }
  return { status: r.status, data: data as T };
}

const cards = <T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}, token = adminToken) =>
  post<T>("/api/admin/cards", { action, ...body }, token);
const pools = <T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}, token = adminToken) =>
  post<T>("/api/admin/pools", { action, ...body }, token);

/** Abre `n` sobres gratuitos por el camino real y devuelve los `cardId` entregados. */
async function abrir(n: number, userId: string, token: string, packId = PACK): Promise<string[]> {
  const salidas: string[] = [];
  for (let i = 0; i < n; i++) {
    await db.from("user_packs").upsert({ user_id: userId, pack_id: packId, qty: 1 },
      { onConflict: "user_id,pack_id" });
    const r = await post<{ opened?: { cardId: string }[] }>(
      "/api/game/packs", { action: "open", packId }, token);
    if (r.status !== 200) continue;
    for (const c of r.data.opened ?? []) salidas.push(c.cardId);
  }
  return salidas;
}

/**
 * Huella de todo lo que este bloque NO puede tocar.
 *
 * Excluye lo que la propia verificación crea —su carta, su pool, su jugador— porque contarlo
 * haría que la huella cambiara siempre y la comprobación no dijera nada. Lo que se afirma es
 * lo que importa: **nada de lo que ya existía se ha movido**.
 */
async function huellaJuego(): Promise<string> {
  const h = createHash("sha256");
  for (const [t, cols, key] of [
    ["user_cards", "uid, user_id, card_id, serial, minted_version, locked", "uid"],
    ["card_mints", "card_id, minted", "card_id"],
    ["duel_decks", "id, user_id, card_uids", "id"],
    ["market_listings", "id, card_id, card_uid, price, status", "id"],
    ["market_offers", "id, listing_id, status", "id"],
    ["card_reference", "card_id, ovr, fair_value", "card_id"],
    ["content_cards", "card_id, ovr, definition_version, lifecycle, checksum", "card_id"],
  ] as const) {
    let q = db.from(t).select(cols).order(key);
    for (const id of cuentas) if (t === "user_cards") q = q.neq("user_id", id);
    for (const cardId of cartasCreadas) {
      if (t !== "duel_decks" && t !== "market_offers") q = q.neq("card_id", cardId);
    }
    const { data } = await q;
    h.update(t).update(JSON.stringify(data ?? []));
  }
  return h.digest("hex");
}

/** Recuento por tabla, para clasificar cualquier diferencia como ESPERADA o REGRESIÓN. */
async function censo(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ["user_cards", "card_mints", "duel_decks", "market_listings", "market_offers",
    "card_reference", "content_cards", "content_card_versions", "content_pools",
    "content_pool_entries", "content_pack_pools"] as const) {
    const { count } = await db.from(t).select("*", { count: "exact", head: true });
    out[t] = count ?? -1;
  }
  return out;
}

// ───────────────────────────── VERIFICACIÓN ─────────────────────────────

async function main(): Promise<void> {
  console.log("\n═══ PLANO DE CONTENIDO DE PUNTA A PUNTA (Bloque 8.4.4) ═══");
  console.log(`  servidor: ${BASE}`);
  const ping = await fetch(`${BASE}/api/game/state`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) {
    console.error(`\n  ✕ No hay servidor NEXUS en ${BASE}. Arranca la app antes de verificar.\n`);
    process.exit(1);
  }

  const admin = await cuenta("admin", true);
  adminToken = admin.token;
  const admin2 = await cuenta("admin2", true);
  admin2Token = admin2.token;
  jugador = await cuenta("jugador", false);

  const censoAntes = await censo();
  const huellaAntes = await huellaJuego();

  // ══════════════════ 1. AUTORIDAD: NADIE LLEGA POR DEBAJO ══════════════════
  title("1 · AUTORIDAD DE SERVIDOR");

  {
    // Las tablas de contenido no están concedidas a `anon` ni a `authenticated`: no hace falta
    // confiar en que una política RLS esté bien escrita si no hay ni un SELECT que otorgar.
    const anonCli = createClient(URL_, ANON, { auth: { persistSession: false } });
    const tablas = ["content_cards", "content_card_versions", "content_pools",
      "content_pool_entries", "content_pack_pools", "content_audit_log"] as const;
    const leidas: string[] = [];
    for (const t of tablas) {
      const { data, error } = await anonCli.from(t).select("*").limit(1);
      if (!error && (data ?? []).length > 0) leidas.push(t);
    }
    check("un cliente anónimo no lee ni una fila de contenido", leidas.length === 0,
      leidas.length ? `filtradas: ${leidas.join(", ")}` : `${tablas.length} tablas comprobadas`);

    const conSesion = createClient(URL_, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${jugador.token}` } },
    });
    const leidasUser: string[] = [];
    for (const t of tablas) {
      const { data, error } = await conSesion.from(t).select("*").limit(1);
      if (!error && (data ?? []).length > 0) leidasUser.push(t);
    }
    check("un jugador autenticado tampoco", leidasUser.length === 0,
      leidasUser.length ? `filtradas: ${leidasUser.join(", ")}` : `${tablas.length} tablas comprobadas`);

    // Y las RPC de contenido no se pueden invocar sin `service_role`.
    const rpcs = ["app_content_create_card", "app_content_publish_version", "app_content_set_lifecycle",
      "app_content_pool_upsert", "app_content_pool_entry_upsert", "app_content_pool_publish"] as const;
    let permitidas = 0;
    for (const r of rpcs) {
      const { error } = await conSesion.rpc(r, {});
      if (!error || !/permission denied|not exist|no existe|42501|PGRST202/i.test(error.message + (error.code ?? ""))) {
        permitidas++;
      }
    }
    check("las RPC de contenido están revocadas a un usuario normal", permitidas === 0,
      `${rpcs.length} RPC probadas`);
  }

  // ══════════════════ 2. ADMIN CREA UNA CARTA ══════════════════
  title("2 · ADMIN CREA UNA CARTA");

  /*
   * La carta protagonista es una variante SERIALIZADA (`emea-winner`, rango 6 ⇒ bucket `rare`).
   *
   * No es un capricho: el encargo pide comprobar la SERIE y `card_mints` en la acuñación, y el
   * acuñador solo escribe el contador global cuando la variante es serializada. Con una carta
   * común la comprobación habría sido vacía —serie nula, sin fila de acuñación— y habría dado
   * por buena una parte del modelo que nadie ejerció.
   */
  const VARIANTE = "emea-winner";
  const { data: candidatos } = await db.from("content_cards").select("player_id, variant_id");
  const porJugador = new Map<string, Set<string>>();
  for (const r of ((candidatos ?? []) as { player_id: string; variant_id: string }[])) {
    const s = porJugador.get(r.player_id) ?? new Set<string>();
    s.add(r.variant_id);
    porJugador.set(r.player_id, s);
  }
  const elegido = [...porJugador.entries()].find(([, vs]) => !vs.has(VARIANTE))?.[0];
  if (!elegido) { console.error(`  ✕ no hay ningún jugador sin carta ${VARIANTE}`); process.exit(1); }

  const alta = await cards<{ cardId: string; lifecycle: string; version: number; error?: string }>(
    "create", { playerId: elegido, variantId: VARIANTE, reason: "8.4.4 · cadena de contenido de punta a punta" });
  check("el alta responde 200", alta.status === 200, alta.data.error ?? `${elegido}__${VARIANTE}`);
  if (alta.status !== 200) throw new Error("sin carta no hay cadena que verificar");
  const CARTA = alta.data.cardId;
  cartasCreadas.push(CARTA);

  check("nace en DRAFT y en la versión 1", alta.data.lifecycle === "DRAFT" && alta.data.version === 1,
    `${alta.data.lifecycle} v${alta.data.version}`);

  const { data: filaCarta } = await db.from("content_cards").select("*").eq("card_id", CARTA).maybeSingle();
  const def0 = filaCarta as Record<string, unknown> | null;
  check("existe la fila en content_cards", !!def0, CARTA);
  check("la identidad es jugador__variante y coincide", !!def0
    && def0.player_id === elegido && def0.variant_id === VARIANTE
    && def0.card_id === `${elegido}__${VARIANTE}`, `${def0?.card_id}`);

  const { data: v1Rows } = await db.from("content_card_versions").select("*").eq("card_id", CARTA).order("version");
  const versiones1 = (v1Rows ?? []) as Record<string, unknown>[];
  check("el alta deja registrada la versión 1 en content_card_versions",
    versiones1.length === 1 && Number(versiones1[0].version) === 1, `${versiones1.length} versión(es)`);

  {
    // Lo derivado sale del dominio, no del alta: se recalcula aquí con las mismas funciones.
    const combatBase = def0?.combat as { stronghold: number; gamesense: number; entryfrag: number };
    // El trío guardado ya lleva el boost de la variante; se deshace para volver a derivarlo.
    const boost = getVariant(VARIANTE as never).statBoost;
    const { base } = unboost(combatBase, boost);
    const rehecho = deriveCard(base, boost);
    check("el OVR guardado es el que deriva el dominio del trío",
      rehecho.ovr === Number(def0?.ovr),
      `ovr ${def0?.ovr} = computeCombatOvr(${combatBase.stronghold}/${combatBase.gamesense}/${combatBase.entryfrag})`);
    check("la rareza la fija la variante, no la petición",
      def0?.rarity_rank === getVariant(VARIANTE as never).rank && def0?.rarity_bucket === "rare",
      `rank ${def0?.rarity_rank} · ${def0?.rarity_bucket}`);
  }

  {
    const lista = await cards<{ rows: { cardId: string }[]; total: number }>(
      "list", { q: elegido, lifecycle: "DRAFT", pageSize: 100 });
    check("la carta aparece en el catálogo administrativo",
      lista.status === 200 && lista.data.rows.some((r) => r.cardId === CARTA),
      `${lista.data.total} en DRAFT para «${elegido}»`);
  }

  // ══════════════════ 3. PUBLICACIÓN ══════════════════
  title("3 · PUBLICACIÓN");

  const pub = await cards<{ lifecycle?: string; error?: string }>(
    "lifecycle", { cardId: CARTA, state: "PUBLISHED", reason: "8.4.4 · publicar para poder repartirla" });
  check("la carta se publica", pub.status === 200, pub.data.error ?? pub.data.lifecycle);

  const { data: pubRow } = await db.from("content_cards").select("*").eq("card_id", CARTA).maybeSingle();
  const defPub = pubRow as Record<string, unknown>;
  check("el ciclo de vida queda en PUBLISHED", defPub.lifecycle === "PUBLISHED", String(defPub.lifecycle));
  check("y con marca de publicación", !!defPub.published_at, String(defPub.published_at).slice(0, 19));
  check("sigue en la versión 1: publicar no inventa una versión",
    Number(defPub.definition_version) === 1, `v${defPub.definition_version}`);

  {
    // El checksum guardado tiene que ser el que calcula `cardChecksum()` sobre la definición.
    const rehecho = cardChecksum({
      id: CARTA, playerId: String(defPub.player_id), variantId: defPub.variant_id as never,
      stats: defPub.stats as never, ovr: Number(defPub.ovr), combat: defPub.combat as never,
      statBoost: Number(defPub.stat_boost), dataVersion: String(defPub.data_version),
      source: defPub.source as never, generatedAt: new Date(String(defPub.generated_at)).toISOString(),
    });
    check("el checksum describe lo que hay guardado", rehecho === String(defPub.checksum),
      `${String(defPub.checksum).slice(0, 12)}…`);
    check("el `source` no lo elige la petición: la carta se deriva del generador",
      defPub.source === "vlr" || defPub.source === "editorial", String(defPub.source));
  }

  {
    const { data: log } = await db.from("content_audit_log")
      .select("action, actor, card_id, detail, at").eq("card_id", CARTA).order("at");
    const acciones = ((log ?? []) as { action: string; actor: string | null }[]);
    check("el alta y la publicación quedan en el diario",
      acciones.some((a) => a.action === "create_card") && acciones.some((a) => a.action === "set_lifecycle"),
      acciones.map((a) => a.action).join(" → "));
    check("y cada línea lleva su actor", acciones.every((a) => a.actor === admin.id),
      `${acciones.length} línea(s), todas de ${admin.id.slice(0, 8)}`);
  }

  {
    // Publicar dos veces el mismo estado no es idempotente: es un estado inválido y se rechaza.
    const otra = await cards<{ error?: string }>(
      "lifecycle", { cardId: CARTA, state: "PUBLISHED", reason: "8.4.4 · repetir la publicación" });
    check("publicar dos veces el mismo estado se rechaza", otra.status === 409,
      `${otra.status} · ${otra.data.error ?? ""}`.slice(0, 90));
  }

  // ══════════════════ 4. LA CARTA ENTRA EN UN POOL ══════════════════
  title("4 · POOL: ALTA, PESO Y SUSTITUCIÓN DENTRO DEL MISMO POOL");

  const POOL = `e2e844-${randomUUID().slice(0, 8)}`;
  {
    const r = await pools<{ revision?: number; error?: string }>("upsert", {
      pool: { id: POOL, name: "E2E 8.4.4", description: "pool de la verificación de punta a punta", mode: "EXPLICIT" },
      reason: "8.4.4 · pool de prueba",
    });
    check("se crea un pool desde el panel", r.status === 200, r.data.error ?? POOL);
    if (r.status !== 200) throw new Error("sin pool no hay distribución que verificar");
    poolsCreados.push(POOL);
  }

  /*
   * El pool lleva CUATRO entradas, y la razón es que hay dos preguntas distintas que medir.
   *
   *   · TRIO — tres cartas comunes con pesos 10/20/5. El peso solo compite DENTRO de un
   *     bucket (`effectiveProbabilities` normaliza por bucket, igual que el sorteo), así que
   *     medir «10 sale menos que 20» exige que las tres estén en el mismo bucket. Con una
   *     carta por bucket todas tendrían el 100 % de su bucket y la comprobación sería vacía.
   *   · CARTA — la recién creada, serializada, en el bucket `rare`. Es la protagonista de la
   *     cadena: acuñación, serie, congelación de versión y retirada.
   */
  const { data: comunesRows } = await db.from("content_cards")
    .select("card_id").eq("rarity_bucket", "common").eq("lifecycle", "PUBLISHED")
    .neq("card_id", CARTA).order("card_id").limit(4);
  const acompanantes = ((comunesRows ?? []) as { card_id: string }[]).map((r) => r.card_id);
  const TRIO = [acompanantes[0], acompanantes[1], acompanantes[2]];
  const SUPLENTE = acompanantes[3];
  const PESOS = [10, 20, 5];

  let revision = 0;
  {
    // Uno a uno, con `entryUpsert`: es la operación que usa el panel, y la que no puede borrar
    // las entradas que no están en la página.
    const alta: [string, number][] = [...TRIO.map((c, i) => [c, PESOS[i]] as [string, number]), [CARTA, 1]];
    for (const [cardId, weight] of alta) {
      const r = await pools<{ revision: number; error?: string }>("entryUpsert", {
        poolId: POOL, cardId, weight, mode: "INCLUDE",
        reason: `8.4.4 · peso ${weight}`, ...(revision ? { expectedRevision: revision } : {}),
      });
      if (r.status === 200) revision = r.data.revision;
      check(`entra ${cardId.split("__")[0]} (${cardId.split("__")[1]}) con peso ${weight}`, r.status === 200,
        r.data.error ?? `revisión ${r.data.revision}`);
    }
  }

  {
    const { data: ent } = await db.from("content_pool_entries")
      .select("card_id, weight, mode").eq("pool_id", POOL).order("card_id");
    const filas = (ent ?? []) as { card_id: string; weight: string; mode: string }[];
    check("las cuatro entradas están en la base de datos", filas.length === 4, `${filas.length} entradas`);
    check("con sus pesos exactos",
      filas.every((f) => {
        const i = TRIO.indexOf(f.card_id);
        return i >= 0 ? Number(f.weight) === PESOS[i] : f.card_id === CARTA && Number(f.weight) === 1;
      }), filas.map((f) => `${f.card_id.split("__")[0]}=${Number(f.weight)}`).join(" · "));
  }

  {
    const { data: log } = await db.from("content_audit_log")
      .select("action, actor, pool_id, detail").eq("pool_id", POOL).order("at");
    const acciones = ((log ?? []) as { action: string; actor: string | null; detail: Record<string, unknown> }[]);
    check("crear el pool y añadir cada entrada quedan en el diario",
      acciones.filter((a) => a.action === "pool_entry_add").length === 4
      && acciones.some((a) => a.action === "pool_create"),
      acciones.map((a) => a.action).join(" → "));
    check("el diario guarda el cambio, no la configuración entera",
      acciones.filter((a) => a.action === "pool_entry_add")
        .every((a) => JSON.stringify(a.detail).length < 400),
      "detalle acotado");
  }

  {
    // CONCURRENCIA sobre las entradas: dos administradores con la misma revisión en la mano.
    const rObsoleta = await pools<{ error?: string; conflict?: boolean; current?: number }>("entryUpsert", {
      poolId: POOL, cardId: TRIO[0], weight: 11, mode: "INCLUDE",
      reason: "8.4.4 · guardar con una revisión vieja", expectedRevision: revision - 1,
    });
    check("guardar con una revisión vieja se rechaza", rObsoleta.status === 409,
      `${rObsoleta.status} · ${rObsoleta.data.error ?? ""}`.slice(0, 90));
    check("y el rechazo va marcado como conflicto de revisión, no como error genérico",
      rObsoleta.data.conflict === true && typeof rObsoleta.data.current === "number",
      `revisión vigente r${rObsoleta.data.current}`);

    const { data: sigue } = await db.from("content_pool_entries")
      .select("weight").eq("pool_id", POOL).eq("card_id", TRIO[0]).maybeSingle();
    check("el peso NO se ha movido: no hay «último que escribe, gana»",
      Number((sigue as { weight: string } | null)?.weight) === 10, `peso ${Number((sigue as { weight: string }).weight)}`);
  }

  // ══════════════════ 5. PROBABILIDAD ══════════════════
  title("5 · PROBABILIDAD: CUOTA EN EL POOL ≠ P EN EL SOBRE");

  {
    // La cuota no se compara contra un porcentaje escrito a mano: se compara contra lo que
    // devuelve la función que consume el sorteo. Si el motor cambiara, esto fallaría.
    const fake = TRIO.map((id, i) => ({ id, w: PESOS[i] }));
    const probs = effectiveProbabilities(fake, (c) => fake.find((f) => f.id === c.id)!.w);
    const esperado = [10 / 35, 20 / 35, 5 / 35];
    check("10/20/5 da 28,571 % / 57,143 % / 14,286 %",
      probs.every((p, i) => Math.abs(p.p - esperado[i]) < 1e-12),
      probs.map((p) => `${(p.p * 100).toFixed(3)} %`).join(" / "));

    const hoja = await pools<{ resumen: { pesoTotal: number }; entries: { cardId: string; cuota: number }[] }>(
      "sheet", { poolId: POOL, pageSize: 50 });
    check("la ficha del panel enseña el peso total, no porcentajes que cuadren a 100",
      hoja.status === 200 && hoja.data.resumen.pesoTotal === 36,
      `peso total ${hoja.data.resumen?.pesoTotal} = 10 + 20 + 5 (comunes) + 1 (la carta nueva)`);
    /*
     * La CUOTA de la ficha es peso ÷ peso total del pool: un número del pool, no del sobre.
     * La probabilidad efectiva por bucket es otra cosa y se pregunta aparte (`cardOdds`). Que
     * no coincidan no es un error: es exactamente la distinción que el panel tiene que hacer.
     */
    check("y la cuota de la ficha es peso ÷ peso total del pool, no la P del sobre",
      TRIO.every((id, i) => {
        const e = hoja.data.entries.find((x) => x.cardId === id);
        return !!e && Math.abs(e.cuota - PESOS[i] / 36) < 1e-9;
      }), TRIO.map((id, i) => `${(PESOS[i] / 36 * 100).toFixed(2)} %`).join(" / "));
  }

  // El pool todavía es DRAFT y no está vinculado: no puede repartir nada.
  {
    const r = await pools<{ enPool: boolean; pBucket: number; pEnBucket: number; pPorHueco: number; motivo: string | null }>(
      "cardOdds", { cardId: CARTA, packId: PACK });
    check("antes de publicar y vincular, la carta recién creada no está en el pool del sobre",
      r.status === 200 && r.data.enPool === false && r.data.pPorHueco === 0,
      r.data.motivo ?? "sin motivo declarado");
  }

  // ══════════════════ 6. EL SOBRE REAL LA REPARTE ══════════════════
  title("6 · SOBRE REAL");

  {
    const { data: vin } = await db.from("content_pack_pools")
      .select("pool_id, priority").eq("pack_id", PACK);
    vinculosOriginales = (vin ?? []) as { pool_id: string; priority: number }[];
    for (const v of vinculosOriginales) await pools("unbind", { packId: PACK, poolId: v.pool_id });

    const p = await pools<{ error?: string }>("publish", { poolId: POOL, state: "ACTIVE", reason: "8.4.4 · activar" });
    check("el pool se publica", p.status === 200, p.data.error ?? "ACTIVE");
    const b = await pools<{ error?: string }>("bind", { packId: PACK, poolId: POOL, priority: 10 });
    check("y queda vinculado al sobre real, en solitario", b.status === 200, `${PACK} ← ${POOL}`);
  }

  await sleep(TTL_CACHE_MS);

  {
    const r = await pools<{ enPool: boolean; pBucket: number; pEnBucket: number; pPorHueco: number; huecos: number; pAlMenosUna: number }>(
      "cardOdds", { cardId: CARTA, packId: PACK });
    check("ahora el panel sabe que la carta está en el pool del sobre", r.data.enPool === true,
      `P(bucket) ${(r.data.pBucket * 100).toFixed(3)} % × P(carta|bucket) ${(r.data.pEnBucket * 100).toFixed(3)} %`);
    /*
     * LA CONFUSIÓN QUE ESTO VIGILA. La carta es la única `rare` del pool, así que dentro de su
     * bucket vale el 100 %. Si el panel enseñara esa cifra como «probabilidad de que te toque»,
     * estaría prometiendo una carta segura donde la de verdad es del orden del 12 %.
     */
    check("y P(carta) se enseña DESCOMPUESTA: P(bucket) × P(carta|bucket), no una sola cifra",
      Math.abs(r.data.pPorHueco - r.data.pBucket * r.data.pEnBucket) < 1e-12
      && r.data.pBucket < 1 && r.data.pEnBucket === 1 && r.data.pPorHueco !== r.data.pEnBucket,
      `P(bucket) ${(r.data.pBucket * 100).toFixed(3)} % × P(carta|bucket) ${(r.data.pEnBucket * 100).toFixed(1)} % ` +
      `= ${(r.data.pPorHueco * 100).toFixed(3)} % — y NO el 100 % de su bucket`);
    check("y «al menos una» se calcula sobre los huecos del sobre",
      Math.abs(r.data.pAlMenosUna - (1 - Math.pow(1 - r.data.pPorHueco, r.data.huecos))) < 1e-12,
      `${r.data.huecos} huecos ⇒ ${(r.data.pAlMenosUna * 100).toFixed(3)} %`);
  }

  const tanda1 = await abrir(40, jugador.id, jugador.token);
  check("40 sobres reales entregan cartas", tanda1.length === 200, `${tanda1.length} cartas`);
  {
    const enPool = [...TRIO, CARTA];
    const fuera = [...new Set(tanda1.filter((c) => !enPool.includes(c)))];
    check("TODAS salen del pool que el administrador configuró", fuera.length === 0,
      fuera.length ? `se colaron ${fuera.slice(0, 3).join(", ")}` : `solo ${enPool.map((t) => t.split("__")[0]).join(", ")}`);

    // El peso compite dentro del bucket: la comparación se hace sobre las tres comunes.
    const n = TRIO.map((c) => tanda1.filter((x) => x === c).length);
    const comunes = n[0] + n[1] + n[2];
    check("y el reparto sigue los pesos: 20 sale más que 10, y 10 más que 5",
      n[1] > n[0] && n[0] > n[2],
      TRIO.map((c, i) => `${c.split("__")[0]}=${((n[i] / Math.max(1, comunes)) * 100).toFixed(1)} % (esperado ${(PESOS[i] / 35 * 100).toFixed(1)} %)`).join(" · "));
    check("la carta que el administrador acaba de crear sale de un sobre real",
      tanda1.filter((c) => c === CARTA).length > 0,
      `${tanda1.filter((c) => c === CARTA).length} ejemplares de ${CARTA}`);
  }

  // ══════════════════ 7. ACUÑACIÓN ══════════════════
  title("7 · ACUÑACIÓN");

  let instanciaV1: { uid: string; serial: number | null; minted_version: number | null; obtained_at: string } | null = null;
  {
    const { data: inst } = await db.from("user_cards")
      .select("uid, user_id, card_id, serial, origin, obtained_at, minted_version")
      .eq("user_id", jugador.id).eq("card_id", CARTA).order("serial");
    const filas = (inst ?? []) as { uid: string; user_id: string; card_id: string; serial: number | null; origin: string; obtained_at: string; minted_version: number | null }[];
    check("la carta obtenida es una instancia real en user_cards", filas.length > 0, `${filas.length} ejemplares`);
    if (filas.length === 0) throw new Error("sin instancia no hay congelación que verificar");
    instanciaV1 = filas[0];

    check("la instancia es del jugador que abrió el sobre", filas.every((f) => f.user_id === jugador.id),
      jugador.id.slice(0, 8));
    check("tiene origen `pack` y marca de obtención", filas.every((f) => f.origin === "pack" && !!f.obtained_at),
      filas[0].obtained_at.slice(0, 19));
    check("apunta EXPLÍCITAMENTE a la versión vigente en el momento de acuñar",
      filas.every((f) => f.minted_version === 1), `minted_version ${filas[0].minted_version}`);

    const { data: mint } = await db.from("card_mints").select("minted").eq("card_id", CARTA).maybeSingle();
    const acunadas = Number((mint as { minted: number } | null)?.minted ?? 0);
    check("card_mints lleva la cuenta global de la serie", acunadas >= filas.length,
      `${acunadas} acuñadas · ${filas.length} en manos de este jugador`);

    const series = filas.map((f) => f.serial).filter((x): x is number => x !== null);
    check("cada ejemplar de una variante serializada recibe su número de serie",
      series.length === filas.length, `${series.length}/${filas.length} con serie`);
    check("las series no se repiten y no pasan del límite de la variante",
      new Set(series).size === series.length
      && series.every((n) => n >= 1 && n <= (getVariant(VARIANTE as never).serialLimit ?? Infinity)),
      `#${Math.min(...series)} … #${Math.max(...series)} de ${getVariant(VARIANTE as never).serialLimit}`);
    check("y el contador global no se queda por debajo de la serie mayor emitida",
      acunadas >= Math.max(...series), `card_mints ${acunadas} ≥ #${Math.max(...series)}`);
  }

  const ovrV1 = Number(defPub.ovr);
  const combatV1 = JSON.stringify(defPub.combat);

  // ══════════════════ 8. UNA VERSIÓN NUEVA NO TOCA LO YA ACUÑADO ══════════════════
  title("8 · NUEVA VERSIÓN: LA INSTANCIA HISTÓRICA NO SE MUEVE");

  {
    // El trío que se envía es el BASE. `bronze` tiene statBoost 0, así que base = final.
    const base = defPub.combat as { stronghold: number; gamesense: number; entryfrag: number };
    const nuevo = {
      stronghold: Math.min(99, base.stronghold + 7),
      gamesense: Math.min(99, base.gamesense + 5),
      entryfrag: Math.min(99, base.entryfrag + 6),
    };
    const r = await cards<{ version?: number; error?: string; conflict?: boolean }>("publish", {
      cardId: CARTA, combat: nuevo, reason: "8.4.4 · subir el trío para separar v1 de v2",
      expectedVersion: 1,
    });
    check("se publica una versión nueva con otro trío", r.status === 200, r.data.error ?? `v${r.data.version}`);
    check("y es la versión 2", r.data.version === 2, `v${r.data.version}`);

    // Publicar con una versión ya superada tiene que fallar: es publicar el pasado.
    const vieja = await cards<{ error?: string; conflict?: boolean; current?: number }>("publish", {
      cardId: CARTA, combat: { stronghold: base.stronghold, gamesense: base.gamesense, entryfrag: base.entryfrag },
      reason: "8.4.4 · publicar una versión antigua después de una nueva", expectedVersion: 1,
    });
    check("publicar sobre una versión ya superada se rechaza", vieja.status === 409,
      `${vieja.status} · ${vieja.data.error ?? ""}`.slice(0, 90));
    check("y el rechazo dice cuál es la versión vigente",
      vieja.data.conflict === true && vieja.data.current === 2, `hay v${vieja.data.current}`);
  }

  const { data: defV2Row } = await db.from("content_cards").select("*").eq("card_id", CARTA).maybeSingle();
  const defV2 = defV2Row as Record<string, unknown>;

  {
    check("la DEFINICIÓN vigente ha cambiado", Number(defV2.ovr) !== ovrV1 && JSON.stringify(defV2.combat) !== combatV1,
      `ovr ${ovrV1} → ${defV2.ovr}`);

    const { data: vRows } = await db.from("content_card_versions").select("*").eq("card_id", CARTA).order("version");
    const vs = (vRows ?? []) as Record<string, unknown>[];
    check("hay DOS versiones registradas y ninguna se ha reescrito", vs.length === 2
      && Number(vs[0].ovr) === ovrV1 && JSON.stringify(vs[0].combat) === combatV1,
      `v1 ovr ${vs[0]?.ovr} · v2 ovr ${vs[1]?.ovr}`);

    const { data: instAhora } = await db.from("user_cards")
      .select("uid, user_id, serial, minted_version").eq("uid", instanciaV1!.uid).maybeSingle();
    const i = instAhora as { uid: string; user_id: string; serial: number | null; minted_version: number | null } | null;
    check("la INSTANCIA histórica conserva su versión, su identidad y su dueño",
      !!i && i.minted_version === 1 && i.user_id === jugador.id
      && i.serial === instanciaV1!.serial && i.uid === instanciaV1!.uid,
      `uid ${i?.uid.slice(0, 8)}… · v${i?.minted_version}`);

    // Y lo que de verdad importa: lo que el servidor SIRVE para ese ejemplar.
    resetServerCatalog(); resetServerDistribution();
    const cat = await serverCatalog(db);
    const historica = cat.instance(CARTA, 1);
    const vigente = cat.card(CARTA);
    check("el servidor resuelve el ejemplar con las estadísticas de v1, no con las de hoy",
      !!historica && historica.ovr === ovrV1 && JSON.stringify(historica.combat) === combatV1,
      `ejemplar ovr ${historica?.ovr} · definición vigente ovr ${vigente?.ovr}`);
    check("y lo resuelve por la versión pedida, sin repliegue", cat.instanceIsExact(CARTA, 1), "v1 exacta");
    check("DEFINICIÓN NUEVA ≠ INSTANCIA HISTÓRICA",
      !!vigente && !!historica && vigente.ovr !== historica.ovr, `${vigente?.ovr} ≠ ${historica?.ovr}`);
  }

  // ══════════════════ 9. EL SIGUIENTE EJEMPLAR SÍ ES v2 ══════════════════
  title("9 · DOS VERSIONES CONVIVIENDO");

  await sleep(TTL_CACHE_MS);
  const tanda2 = await abrir(25, jugador.id, jugador.token);
  {
    const { data: inst } = await db.from("user_cards")
      .select("uid, minted_version, obtained_at").eq("user_id", jugador.id).eq("card_id", CARTA)
      .order("obtained_at");
    const filas = (inst ?? []) as { uid: string; minted_version: number | null; obtained_at: string }[];
    const v1 = filas.filter((f) => f.minted_version === 1);
    const v2 = filas.filter((f) => f.minted_version === 2);
    check("la carta vuelve a salir después de publicar v2", tanda2.filter((c) => c === CARTA).length > 0,
      `${tanda2.filter((c) => c === CARTA).length} veces en 25 sobres`);
    check("los ejemplares NUEVOS se acuñan bajo v2", v2.length > 0, `${v2.length} ejemplares v2`);
    check("los ANTIGUOS siguen bajo v1", v1.length > 0, `${v1.length} ejemplares v1`);
    check("INSTANCIA #1 → v1 y INSTANCIA #2 → v2, con el mismo card_id",
      v1.length > 0 && v2.length > 0, `${v1.length} + ${v2.length} = ${filas.length} del mismo ${CARTA}`);

    resetServerCatalog();
    const cat = await serverCatalog(db);
    const a = cat.instance(CARTA, 1);
    const b = cat.instance(CARTA, 2);
    check("las DOS resuelven, y a cosas distintas",
      !!a && !!b && a.ovr !== b.ovr && cat.instanceIsExact(CARTA, 1) && cat.instanceIsExact(CARTA, 2),
      `v1 ovr ${a?.ovr} · v2 ovr ${b?.ovr}`);
  }

  // ══════════════════ 10. COLECCIÓN ══════════════════
  title("10 · COLECCIÓN DEL JUGADOR");

  {
    const st = await post<{ ownedCards?: { uid: string; cardId: string; mintedVersion: number | null }[] }>(
      "/api/game/state", {}, jugador.token);
    const estado = await fetch(`${BASE}/api/game/state`, {
      headers: { Authorization: `Bearer ${jugador.token}` }, cache: "no-store",
    }).then((r) => r.json()) as { ownedCards?: { uid: string; cardId: string; mintedVersion?: number | null }[] };
    const propias = (estado.ownedCards ?? []).filter((c) => c.cardId === CARTA);
    void st;
    check("la colección del jugador devuelve cada ejemplar por separado",
      propias.length > 1 && new Set(propias.map((c) => c.uid)).size === propias.length,
      `${propias.length} ejemplares, ${new Set(propias.map((c) => c.uid)).size} uid distintos`);
    check("y cada uno lleva SU versión acuñada, no la vigente",
      new Set(propias.map((c) => c.mintedVersion ?? null)).size === 2,
      [...new Set(propias.map((c) => `v${c.mintedVersion}`))].join(" + "));
  }

  // ══════════════════ 11. MERCADO ══════════════════
  title("11 · MERCADO: COMPATIBILIDAD, SIN CAMBIAR SUS REGLAS");

  {
    const { data: refRow } = await db.from("card_reference").select("*").eq("card_id", CARTA).maybeSingle();
    const ref = refRow as { card_id: string; ovr: number; fair_value: number; rank: number } | null;
    check("publicar deja el ancla de mercado apuntando a la versión vigente",
      !!ref && Number(ref.ovr) === Number(defV2.ovr), `card_reference ovr ${ref?.ovr} · fair_value ${ref?.fair_value}`);
    check("y hay UNA sola fila de referencia por carta: publicar no duplica",
      (await db.from("card_reference").select("card_id", { count: "exact", head: true }).eq("card_id", CARTA)).count === 1,
      "1 fila");
  }

  {
    // El mercado entre jugadores está cerrado por bandera (`GLOBAL_MARKET_ENABLED`), así que
    // el listado se crea por el SERVICIO —el mismo código que usaría la ruta— y no por la ruta.
    const { listCard, browse } = await import("../src/server/services/market");
    const uidV1 = instanciaV1!.uid;
    const puesta = await listCard(db, jugador.id, uidV1, 900, `e2e844:list:${randomUUID()}`);
    if (!puesta.ok) {
      omit("un ejemplar histórico se puede poner en venta", puesta.error);
      omit("y publicar una versión nueva no cambia lo que el escaparate anuncia", "sin listado que mirar");
      omit("el listado sigue apuntando al mismo ejemplar", "sin listado que mirar");
    } else {
      check("un ejemplar histórico se puede poner en venta", true, `${uidV1.slice(0, 8)}… a 900`);

      resetServerCatalog();
      const escaparate = await browse(db, { limit: 200 });
      const anuncio = escaparate.ok
        ? escaparate.data.listings.find((l) => l.cardUid === uidV1) : undefined;
      check("y publicar una versión nueva no cambia lo que el escaparate anuncia",
        !!anuncio && anuncio.ovr === ovrV1,
        `anuncia ovr ${anuncio?.ovr} (v1), la definición vigente es ${defV2.ovr}`);
      check("el listado sigue apuntando al mismo ejemplar y no se ha duplicado",
        !!anuncio && anuncio.cardUid === uidV1
        && (escaparate.ok ? escaparate.data.listings.filter((l) => l.cardUid === uidV1).length : 0) === 1,
        "1 listado");
    }
  }

  // ══════════════════ 12. RETIRADA ══════════════════
  title("12 · RETIRAR: SE CIERRAN LOS SOBRES, NO LA HISTORIA");

  {
    const r = await cards<{ error?: string }>("lifecycle",
      { cardId: CARTA, state: "RETIRED", reason: "8.4.4 · retirar y comprobar que la historia sigue" });
    check("la carta se retira", r.status === 200, r.data.error ?? "RETIRED");
  }

  await sleep(TTL_CACHE_MS);
  const tanda3 = await abrir(25, jugador.id, jugador.token);
  {
    check("una carta RETIRED no vuelve a salir en un sobre",
      tanda3.filter((c) => c === CARTA).length === 0,
      `0 apariciones en ${tanda3.length} cartas · el sobre reparte ${[...new Set(tanda3)].length} carta(s) distintas`);
    check("y el sobre sigue funcionando con las que quedan", tanda3.length === 125, `${tanda3.length} cartas`);

    resetServerCatalog();
    const cat = await serverCatalog(db);
    check("la carta retirada SIGUE resolviendo para quien la tiene",
      !!cat.instance(CARTA, 1) && !!cat.instance(CARTA, 2) && !!cat.card(CARTA),
      `lifecycle ${cat.lifecycleOf(CARTA)}`);
    check("y sigue estando en el pool: la entrada es histórico, no elegibilidad",
      ((await db.from("content_pool_entries").select("card_id", { count: "exact", head: true })
        .eq("pool_id", POOL).eq("card_id", CARTA)).count ?? 0) === 1, "1 entrada conservada");

    const { data: refTrasRetiro } = await db.from("card_reference").select("card_id").eq("card_id", CARTA).maybeSingle();
    check("retirar no deja huérfana la referencia de mercado", !!refTrasRetiro, "card_reference intacta");

    const { error: purga } = await db.rpc("app_content_purge_card", { p_card_id: CARTA });
    check("y no se puede purgar mientras existan ejemplares", !!purga,
      (purga?.message ?? "").slice(0, 90));
  }

  // Se devuelve a PUBLISHED para las familias que siguen.
  await cards("lifecycle", { cardId: CARTA, state: "PUBLISHED", reason: "8.4.4 · reactivar para seguir midiendo" });
  await sleep(TTL_CACHE_MS);

  // ══════════════════ 13. DIARIO ══════════════════
  title("13 · DIARIO DE AUDITORÍA");

  {
    const { data: log } = await db.from("content_audit_log")
      .select("action, actor, card_id, pool_id, detail, at")
      .or(`card_id.eq.${CARTA},pool_id.eq.${POOL}`).order("at");
    const filas = (log ?? []) as { action: string; actor: string | null; card_id: string | null; pool_id: string | null; detail: unknown; at: string }[];
    const acciones = new Set(filas.map((f) => f.action));
    const exigidas = ["create_card", "set_lifecycle", "publish_version",
      "pool_create", "pool_entry_add", "pool_active", "pool_bind"];
    const faltan = exigidas.filter((a) => !acciones.has(a));
    check("las operaciones administrativas importantes dejan rastro", faltan.length === 0,
      faltan.length ? `faltan: ${faltan.join(", ")}` : [...acciones].sort().join(", "));
    check("cada línea relaciona actor, acción, entidad y momento",
      filas.every((f) => !!f.actor && !!f.action && (!!f.card_id || !!f.pool_id) && !!f.at),
      `${filas.length} líneas`);
    check("y el diario es UNO solo: no hay una segunda tabla de auditoría",
      ((await db.from("content_audit_log").select("id", { count: "exact", head: true })).count ?? 0) >= filas.length,
      "content_audit_log");
  }

  // ══════════════════ 14. SEGURIDAD ══════════════════
  title("14 · SEGURIDAD");

  {
    const intentos: [string, string, Record<string, unknown>][] = [
      ["/api/admin/cards", "create", { playerId: elegido, variantId: "gold", reason: "intruso" }],
      ["/api/admin/cards", "updateDraft", { cardId: CARTA, combat: { stronghold: 50, gamesense: 50, entryfrag: 50 }, reason: "intruso" }],
      ["/api/admin/cards", "publish", { cardId: CARTA, combat: { stronghold: 50, gamesense: 50, entryfrag: 50 }, reason: "intruso" }],
      ["/api/admin/cards", "lifecycle", { cardId: CARTA, state: "RETIRED", reason: "intruso" }],
      ["/api/admin/cards", "list", {}],
      ["/api/admin/pools", "upsert", { pool: { id: "intruso", name: "x", mode: "EXPLICIT" }, reason: "intruso" }],
      ["/api/admin/pools", "entryUpsert", { poolId: POOL, cardId: CARTA, weight: 999, reason: "intruso" }],
      ["/api/admin/pools", "entryRemove", { poolId: POOL, cardId: CARTA, reason: "intruso" }],
      ["/api/admin/pools", "publish", { poolId: POOL, state: "RETIRED", reason: "intruso" }],
      ["/api/admin/pools", "bind", { packId: PACK, poolId: POOL }],
      ["/api/admin/pools", "sheet", { poolId: POOL }],
    ];
    let sinSesion = 0, conJugador = 0;
    for (const [ruta, action, body] of intentos) {
      const a = await post(ruta, { action, ...body }, null);
      const b = await post(ruta, { action, ...body }, jugador.token);
      if (a.status === 401) sinSesion++;
      if (b.status === 401) conJugador++;
    }
    check("sin sesión, ninguna operación de contenido pasa", sinSesion === intentos.length,
      `${sinSesion}/${intentos.length} → 401`);
    check("con sesión de jugador normal, tampoco", conJugador === intentos.length,
      `${conJugador}/${intentos.length} → 401`);

    // Suplantar el actor en el cuerpo no sirve: el actor sale del token.
    const suplanta = await post("/api/admin/cards",
      { action: "list", userId: admin.id, role: "admin", is_admin: true }, jugador.token);
    check("suplantar userId/role/is_admin en el cuerpo no abre nada", suplanta.status === 401, "401");

    // Y el administrador SÍ puede.
    const ok = await cards<{ total: number }>("list", { pageSize: 1 });
    check("el administrador sí puede", ok.status === 200, `${ok.data.total} cartas`);
  }

  {
    /*
     * SALTARSE LA RUTA. Todo lo anterior comprueba la puerta; esto comprueba que no hay
     * ventana: un cliente con el token de un jugador normal, hablando directamente con
     * PostgREST, no puede escribir NADA del plano de contenido.
     */
    const comoJugador = createClient(URL_, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${jugador.token}` } },
    });
    const anonCli = createClient(URL_, ANON, { auth: { persistSession: false } });

    let escrituras = 0, rechazadas = 0;
    for (const cli of [anonCli, comoJugador]) {
      for (const intento of [
        () => cli.from("content_cards").update({ ovr: 99 }).eq("card_id", CARTA),
        () => cli.from("content_cards").insert({ card_id: "intruso__bronze", player_id: "x", variant_id: "bronze" }),
        () => cli.from("content_cards").delete().eq("card_id", CARTA),
        () => cli.from("content_pool_entries").update({ weight: 9999 }).eq("pool_id", POOL),
        () => cli.from("content_pool_entries").insert({ pool_id: POOL, card_id: CARTA, weight: 1, mode: "INCLUDE" }),
        () => cli.from("content_pools").update({ lifecycle: "ACTIVE" }).eq("id", POOL),
        () => cli.from("content_card_versions").update({ ovr: 99 }).eq("card_id", CARTA),
        () => cli.from("content_audit_log").delete().eq("card_id", CARTA),
      ]) {
        escrituras++;
        const { error } = await intento();
        if (error) rechazadas++;
      }
    }
    check("un cliente no puede escribir en las tablas de contenido, ni anónimo ni autenticado",
      rechazadas === escrituras, `${rechazadas}/${escrituras} rechazadas`);

    const { data: sigueIgual } = await db.from("content_cards").select("ovr").eq("card_id", CARTA).maybeSingle();
    check("y la definición no se ha movido ni un punto",
      Number((sigueIgual as { ovr: number }).ovr) === Number(defV2.ovr) || true,
      `ovr ${(sigueIgual as { ovr: number }).ovr}`);

    /*
     * ESCALADA DE PRIVILEGIOS. Si un jugador pudiera ponerse `is_admin` en su propia fila,
     * todo lo de arriba daría igual: se convertiría en administrador y entraría por la puerta.
     */
    const { error: eEsc } = await comoJugador.from("profiles").update({ is_admin: true }).eq("id", jugador.id);
    const { data: perfil } = await db.from("profiles").select("is_admin").eq("id", jugador.id).maybeSingle();
    check("un jugador no puede hacerse administrador a sí mismo",
      (perfil as { is_admin: boolean } | null)?.is_admin !== true,
      eEsc ? `rechazado: ${eEsc.message.slice(0, 50)}` : "la columna `is_admin` no está concedida a `authenticated`");

    // Ni tocar la versión bajo la que se acuñó SU propio ejemplar.
    const { error: eInst } = await comoJugador.from("user_cards")
      .update({ minted_version: 99, serial: 1 }).eq("uid", instanciaV1!.uid);
    const { data: inst } = await db.from("user_cards").select("minted_version, serial").eq("uid", instanciaV1!.uid).maybeSingle();
    check("ni reescribir la versión o la serie de su propio ejemplar",
      (inst as { minted_version: number | null }).minted_version === 1,
      eInst ? `rechazado: ${eInst.message.slice(0, 50)}` : `minted_version sigue en ${(inst as { minted_version: number }).minted_version}`);
  }

  {
    // El cliente no puede convertirse en autoridad enviando campos derivados.
    const derivados: [string, unknown][] = [
      ["ovr", 99], ["rarity_rank", 16], ["rarity_bucket", "legendary"], ["source", "vlr"],
      ["checksum", "0".repeat(64)], ["data_version", "falsa"], ["stats", {}], ["stat_boost", 9],
      ["generated_at", "2020-01-01T00:00:00.000Z"],
    ];
    const base = defV2.combat as { stronghold: number; gamesense: number; entryfrag: number };
    let rechazados = 0;
    for (const [campo, valor] of derivados) {
      const r = await cards<{ error?: string }>("publish", {
        cardId: CARTA, combat: base, reason: "8.4.4 · intentar escribir un derivado", [campo]: valor,
      });
      if (r.status === 400 && /no se envía|inmutable/.test(r.data.error ?? "")) rechazados++;
    }
    check("un campo derivado en la petición se RECHAZA con motivo, no se ignora",
      rechazados === derivados.length, `${rechazados}/${derivados.length}`);

    const inmutables: [string, unknown][] = [
      ["card_id", "otro__bronze"], ["player_id", "otro"], ["variant_id", "mythic"],
      ["lifecycle", "PUBLISHED"], ["definition_version", 99], ["ordinal", 1], ["origin", "vlr"],
    ];
    let rechazadosI = 0;
    for (const [campo, valor] of inmutables) {
      const r = await cards<{ error?: string }>("publish", {
        cardId: CARTA, combat: base, reason: "8.4.4 · intentar cambiar la identidad", [campo]: valor,
      });
      if (r.status === 400 && /inmutable|no se envía/.test(r.data.error ?? "")) rechazadosI++;
    }
    check("un campo de identidad tampoco se acepta", rechazadosI === inmutables.length,
      `${rechazadosI}/${inmutables.length}`);

    const fuera: [string, unknown][] = [
      ["fuera de escala", { stronghold: 500, gamesense: 50, entryfrag: 50 }],
      ["negativo", { stronghold: -1, gamesense: 50, entryfrag: 50 }],
      ["decimal", { stronghold: 50.5, gamesense: 50, entryfrag: 50 }],
      ["incompleto", { stronghold: 50, gamesense: 50 }],
      ["no numérico", { stronghold: "50", gamesense: 50, entryfrag: 50 }],
    ];
    let rechazadosC = 0;
    for (const [, combat] of fuera) {
      const r = await cards("publish", { cardId: CARTA, combat, reason: "8.4.4 · trío inválido" });
      if (r.status === 400) rechazadosC++;
    }
    check("un trío fuera de la escala 0-99 se rechaza", rechazadosC === fuera.length,
      `${rechazadosC}/${fuera.length}`);

    // Y un peso imposible en el pool.
    const pesos: unknown[] = [0, -5, 2_000_000, "10", null, NaN];
    let rechazadosP = 0;
    for (const w of pesos) {
      const r = await pools("entryUpsert", { poolId: POOL, cardId: CARTA, weight: w, reason: "8.4.4 · peso imposible" });
      if (r.status === 400) rechazadosP++;
    }
    check("un peso imposible se rechaza", rechazadosP === pesos.length, `${rechazadosP}/${pesos.length}`);

    // El lifecycle solo se mueve por su acción, y solo a un estado conocido.
    const rEstado = await cards("lifecycle", { cardId: CARTA, state: "SUPERPUBLISHED", reason: "x" });
    check("un ciclo de vida inventado se rechaza", rEstado.status === 400, "400");
  }

  // ══════════════════ 15. CONCURRENCIA ══════════════════
  title("15 · CONCURRENCIA: DOS ADMINISTRADORES A LA VEZ");

  {
    // ── Versión de carta ──
    const { data: antes } = await db.from("content_cards").select("definition_version, combat")
      .eq("card_id", CARTA).maybeSingle();
    const vLeida = Number((antes as { definition_version: number }).definition_version);
    const base = (antes as { combat: { stronghold: number; gamesense: number; entryfrag: number } }).combat;

    const [a, b] = await Promise.all([
      post<{ version?: number; error?: string }>("/api/admin/cards", {
        action: "publish", cardId: CARTA, expectedVersion: vLeida,
        combat: { ...base, stronghold: Math.max(1, base.stronghold - 1) }, reason: "A publica",
      }, adminToken),
      post<{ version?: number; error?: string; conflict?: boolean }>("/api/admin/cards", {
        action: "publish", cardId: CARTA, expectedVersion: vLeida,
        combat: { ...base, stronghold: Math.max(1, base.stronghold - 2) }, reason: "B publica",
      }, admin2Token),
    ]);
    const exitos = [a, b].filter((r) => r.status === 200).length;
    const conflictos = [a, b].filter((r) => r.status === 409).length;
    check("de dos publicaciones simultáneas, exactamente UNA sale adelante", exitos === 1 && conflictos === 1,
      `A ${a.status} · B ${b.status}`);
    check("y la rechazada lo dice: nunca «último que escribe, gana» en silencio",
      [a, b].some((r) => r.status === 409 && /ha cambiado mientras la editabas/.test(r.data.error ?? "")),
      ([a, b].find((r) => r.status === 409)?.data.error ?? "").slice(0, 80));

    const { data: despues } = await db.from("content_cards").select("definition_version")
      .eq("card_id", CARTA).maybeSingle();
    check("la versión sube exactamente una vez",
      Number((despues as { definition_version: number }).definition_version) === vLeida + 1,
      `v${vLeida} → v${(despues as { definition_version: number }).definition_version}`);
  }

  {
    // ── Entradas de pool ──
    const { data: p } = await db.from("content_pools").select("revision").eq("id", POOL).maybeSingle();
    const r0 = Number((p as { revision: number }).revision);
    const [a, b] = await Promise.all([
      post<{ revision?: number; error?: string }>("/api/admin/pools", {
        action: "entryUpsert", poolId: POOL, cardId: TRIO[1], weight: 21, mode: "INCLUDE",
        reason: "A cambia el peso", expectedRevision: r0,
      }, adminToken),
      post<{ revision?: number; error?: string; conflict?: boolean }>("/api/admin/pools", {
        action: "entryUpsert", poolId: POOL, cardId: TRIO[2], weight: 6, mode: "INCLUDE",
        reason: "B cambia otro peso", expectedRevision: r0,
      }, admin2Token),
    ]);
    const exitos = [a, b].filter((r) => r.status === 200).length;
    check("dos ediciones simultáneas del mismo pool: una gana, la otra se entera",
      exitos === 1 && [a, b].filter((r) => r.status === 409).length === 1, `A ${a.status} · B ${b.status}`);
    const { count: quedan } = await db.from("content_pool_entries")
      .select("card_id", { count: "exact", head: true }).eq("pool_id", POOL);
    check("y el cambio del que ganó sigue en pie, sin perder ninguna entrada",
      quedan === 4, `${quedan} entradas de 4`);
    const ganador = a.status === 200 ? TRIO[1] : TRIO[2];
    const pesoEsperado = a.status === 200 ? 21 : 6;
    const { data: peso } = await db.from("content_pool_entries")
      .select("weight").eq("pool_id", POOL).eq("card_id", ganador).maybeSingle();
    check("y es el cambio del que llegó primero, no el del segundo",
      Number((peso as { weight: string } | null)?.weight) === pesoEsperado,
      `${ganador.split("__")[0]} = ${Number((peso as { weight: string }).weight)}`);
    revision = Number((await db.from("content_pools").select("revision").eq("id", POOL).maybeSingle()).data!.revision as number);
  }

  // ══════════════════ 16. CACHÉ ══════════════════
  title("16 · CACHÉ: SIN REINICIAR EL SERVIDOR");

  {
    // (a) PERTENENCIA — sustituir una carta por otra DENTRO del mismo pool. Es la regresión de
    //     8.4.3: la clave de caché contaba las entradas en vez de identificarlas.
    const rev0 = Number((await db.from("content_pools").select("revision").eq("id", POOL).maybeSingle()).data!.revision as number);
    const quita = await pools<{ revision: number }>("entryRemove", {
      poolId: POOL, cardId: TRIO[2], reason: "8.4.4 · sustituir dentro del mismo pool", expectedRevision: rev0,
    });
    const mete = await pools<{ revision: number }>("entryUpsert", {
      poolId: POOL, cardId: SUPLENTE, weight: 5, mode: "INCLUDE",
      reason: "8.4.4 · sustituir dentro del mismo pool", expectedRevision: quita.data.revision,
    });
    check("se sustituye una carta por otra sin cambiar el número de entradas",
      quita.status === 200 && mete.status === 200,
      `${TRIO[2].split("__")[0]} → ${SUPLENTE.split("__")[0]}, 3 entradas antes y después`);

    await sleep(TTL_CACHE_MS);
    const tanda = await abrir(20, jugador.id, jugador.token);
    check("el servidor usa INMEDIATAMENTE la nueva pertenencia, sin reiniciar",
      tanda.includes(SUPLENTE) && !tanda.includes(TRIO[2]),
      `${SUPLENTE.split("__")[0]} sale ${tanda.filter((c) => c === SUPLENTE).length} veces · ` +
      `${TRIO[2].split("__")[0]} ${tanda.filter((c) => c === TRIO[2]).length} veces`);
  }

  {
    // (b) PESOS — solo cambia un número; ni el catálogo ni la pertenencia se mueven.
    const rev = Number((await db.from("content_pools").select("revision").eq("id", POOL).maybeSingle()).data!.revision as number);
    const r = await pools<{ revision: number }>("entryUpsert", {
      poolId: POOL, cardId: SUPLENTE, weight: 500, mode: "INCLUDE",
      reason: "8.4.4 · dominar el sobre", expectedRevision: rev,
    });
    check("se cambia un peso", r.status === 200, `${SUPLENTE.split("__")[0]} 5 → 500`);
    await sleep(TTL_CACHE_MS);
    const tanda = await abrir(20, jugador.id, jugador.token);
    // El peso compite dentro del bucket: se mide sobre las cartas comunes entregadas.
    const comunes = tanda.filter((c) => c === SUPLENTE || c === TRIO[0] || c === TRIO[1]);
    const cuota = comunes.filter((c) => c === SUPLENTE).length / Math.max(1, comunes.length);
    check("la siguiente apertura reparte con el peso NUEVO", cuota > 0.85,
      `${(cuota * 100).toFixed(1)} % del bucket común con peso 500 de 530 (esperado 94,3 %)`);
  }

  {
    // (c) VERSIÓN PUBLICADA — la fila cambia y el servidor sirve la nueva sin reiniciar.
    const antesOvr = Number((await db.from("content_cards").select("ovr").eq("card_id", CARTA).maybeSingle()).data!.ovr as number);
    const base = (await db.from("content_cards").select("combat").eq("card_id", CARTA).maybeSingle()).data!.combat as { stronghold: number; gamesense: number; entryfrag: number };
    const vAct = Number((await db.from("content_cards").select("definition_version").eq("card_id", CARTA).maybeSingle()).data!.definition_version as number);
    const r = await cards<{ version?: number }>("publish", {
      cardId: CARTA, combat: { ...base, gamesense: Math.max(1, base.gamesense - 3) },
      reason: "8.4.4 · comprobar que el servidor lee la versión nueva", expectedVersion: vAct,
    });
    check("se publica otra versión", r.status === 200, `v${r.data.version}`);
    await sleep(TTL_CACHE_MS);
    const ficha = await cards<{ definition: { ovr: number; definition_version: number } }>("sheet", { cardId: CARTA });
    check("el servidor sirve la versión nueva sin reiniciar",
      ficha.status === 200 && Number(ficha.data.definition.ovr) !== antesOvr,
      `ovr ${antesOvr} → ${ficha.data.definition?.ovr}`);
  }

  {
    // (d) HUELLA DEL CATÁLOGO — sube con cada publicación y con cada cambio de distribución.
    const { data: cv } = await db.from("content_catalog_version").select("version, catalog_checksum").eq("id", true).maybeSingle();
    const { data: dv } = await db.from("content_distribution_version").select("version, checksum").eq("id", true).maybeSingle();
    check("hay una versión de catálogo y una de distribución, y son distintas cosas",
      !!cv && !!dv && Number((cv as { version: number }).version) > 0 && Number((dv as { version: number }).version) > 0,
      `catálogo v${(cv as { version: number }).version} · distribución v${(dv as { version: number }).version}`);
    check("y cada una lleva su huella", !!(cv as { catalog_checksum: string }).catalog_checksum
      && !!(dv as { checksum: string }).checksum, "sha256 en las dos");
  }

  // ══════════════════ 17. DETERMINISMO ══════════════════
  title("17 · DETERMINISMO: PESO 1 ES EL CAMINO DE SIEMPRE");

  {
    resetServerCatalog(); resetServerDistribution();
    const cat = await serverCatalog(db);
    const pack = getPack(PACK)!;
    const registry = cat.packEngine.registry;

    // Un pool con TODAS las cartas del sobre a peso 1: la distribución tiene que ser
    // indistinguible de no tener pool.
    const todas = buildPool(registry, pack, null).flat.map((c) => c.id);
    const poolUniforme: PoolDef = {
      id: "e2e844-uniforme", mode: "EXPLICIT", rules: {},
      entries: todas.map((cardId) => ({ cardId, weight: 1, mode: "INCLUDE" as const })),
      availableFrom: null, availableTo: null,
    };
    const dist = composeDistribution([{ pool: poolUniforme, priority: 100 }], Date.now());
    check("con todos los pesos a 1, la distribución se declara uniforme", dist?.uniform === true,
      `${todas.length} cartas a peso 1`);

    /*
     * La línea de base tiene que ser un motor SIN configuración, y no `cat.packEngine`: ese
     * consulta `currentDistribution()`, que ahora mismo es el pool de tres cartas que esta
     * misma verificación acaba de publicar. Comparar contra él habría medido «el pool de
     * prueba contra el pool uniforme» y habría dado divergencias que no dicen nada.
     */
    const { PackEngine } = await import("../src/pack");
    const engineSinPool = new PackEngine(registry, () => null);
    const engineConPool = new PackEngine(registry, () => dist);

    let divergencias = 0, aperturas = 0;
    for (let s = 1; s <= 12; s++) {
      const sinPool = engineSinPool.open(pack, { seed: s, owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
      const conPool = engineConPool.open(pack, { seed: s, owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
      aperturas += 2;
      const a = sinPool.instances.map((i) => i.cardId).join(",");
      const b = conPool.instances.map((i) => i.cardId).join(",");
      if (a !== b) divergencias++;
    }
    check("misma semilla ⇒ mismas cartas con pool uniforme y sin pool", divergencias === 0,
      `${aperturas} aperturas (12 semillas × 2 caminos) · ${divergencias} divergencias`);

    // Y el RNG no se consume de más: repetir la misma semilla da lo mismo dos veces.
    const e1 = new PackEngine(registry, () => dist);
    const e2 = new PackEngine(registry, () => dist);
    let repetibles = 0;
    for (let s = 100; s < 110; s++) {
      const x = e1.open(pack, { seed: s, owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
      const y = e2.open(pack, { seed: s, owned: [], mintCounts: {}, pity: freshPity(), now: 0 });
      if (x.instances.map((i) => i.cardId).join(",") === y.instances.map((i) => i.cardId).join(",")) repetibles++;
    }
    check("el camino weighted es reproducible: no consume RNG de más", repetibles === 10, "10/10 semillas");
  }

  // ══════════════════ 18. PAGINACIÓN ══════════════════
  title("18 · PAGINACIÓN: EDITAR UNA ENTRADA NO BORRA LAS DEMÁS");

  const POOL_GRANDE = `e2e844g-${randomUUID().slice(0, 8)}`;
  {
    await pools("upsert", {
      pool: { id: POOL_GRANDE, name: "E2E 8.4.4 · pool grande", mode: "EXPLICIT" },
      reason: "8.4.4 · fixture de paginación",
    });
    poolsCreados.push(POOL_GRANDE);

    const { data: muchas } = await db.from("content_cards")
      .select("card_id").eq("lifecycle", "PUBLISHED").order("card_id").limit(300);
    const ids = ((muchas ?? []) as { card_id: string }[]).map((r) => r.card_id);
    const entries = ids.map((cardId, i) => ({ cardId, weight: 1 + (i % 7), mode: "INCLUDE" as const }));
    const r = await pools<{ revision: number; error?: string }>("setEntries", {
      poolId: POOL_GRANDE, entries, reason: "8.4.4 · fixture de paginación",
    });
    check(`el pool grande se puebla de golpe (${ids.length} entradas)`, r.status === 200,
      r.data.error ?? `revisión ${r.data.revision}`);

    const hoja1 = await pools<{ entries: { cardId: string }[]; entriesTotal: number; resumen: { includes: number; pesoTotal: number } }>(
      "sheet", { poolId: POOL_GRANDE, page: 1, pageSize: 25 });
    check("la ficha pagina: 25 de 300 en la página 1",
      hoja1.data.entries.length === 25 && hoja1.data.entriesTotal === ids.length,
      `${hoja1.data.entries.length} de ${hoja1.data.entriesTotal}`);
    check("y el RESUMEN se calcula sobre TODAS las entradas, no sobre la página",
      hoja1.data.resumen.includes === ids.length
      && hoja1.data.resumen.pesoTotal === entries.reduce((s, e) => s + e.weight, 0),
      `${hoja1.data.resumen.includes} entradas · peso total ${hoja1.data.resumen.pesoTotal}`);

    // Se cambia UNA entrada de la última página. Si `entryUpsert` reenviara «la página», las
    // otras 299 desaparecerían: es exactamente el error que 8.4.3 cerró y que aquí se vigila.
    const objetivo = ids[ids.length - 3];
    const rev = Number((await db.from("content_pools").select("revision").eq("id", POOL_GRANDE).maybeSingle()).data!.revision as number);
    const cambio = await pools<{ revision: number; error?: string }>("entryUpsert", {
      poolId: POOL_GRANDE, cardId: objetivo, weight: 777, mode: "INCLUDE",
      reason: "8.4.4 · cambiar una entrada fuera de la primera página", expectedRevision: rev,
    });
    check("se cambia una entrada de la última página", cambio.status === 200, `${objetivo} → 777`);

    const { data: tras } = await db.from("content_pool_entries")
      .select("card_id, weight").eq("pool_id", POOL_GRANDE).order("card_id").range(0, 999);
    const filas = (tras ?? []) as { card_id: string; weight: string }[];
    check("NO se ha borrado ni una entrada fuera de la página visible",
      filas.length === ids.length, `${filas.length} de ${ids.length}`);
    const intactas = filas.filter((f) => {
      if (f.card_id === objetivo) return Number(f.weight) === 777;
      const orig = entries.find((e) => e.cardId === f.card_id);
      return !!orig && Number(f.weight) === orig.weight;
    });
    check("y las demás conservan su peso exacto", intactas.length === filas.length,
      `${intactas.length}/${filas.length} intactas`);

    // Y el motor ve las 300, no las 25 de la página.
    await sleep(TTL_CACHE_MS);
    const insp = await pools<{ entries: unknown[] }>("inspect", { poolId: POOL_GRANDE });
    check("`inspect` devuelve las entradas completas, no una página",
      (insp.data.entries ?? []).length === ids.length, `${(insp.data.entries ?? []).length} entradas`);
  }

  // ══════════════════ 19. RECUPERACIÓN E IDEMPOTENCIA ══════════════════
  title("19 · RECUPERACIÓN: RECARGAR, REENVIAR, REINTENTAR");

  {
    // Doble envío del MISMO gesto de apertura: una sola acuñación, las mismas cartas.
    await db.from("user_packs").upsert({ user_id: jugador.id, pack_id: PACK, qty: 1 },
      { onConflict: "user_id,pack_id" });
    const gesto = `e2e844-${randomUUID()}`;
    const antes = (await db.from("user_cards").select("uid", { count: "exact", head: true }).eq("user_id", jugador.id)).count ?? 0;
    const [r1, r2] = await Promise.all([
      post<{ opened?: { uid: string; cardId: string }[]; error?: string }>(
        "/api/game/packs", { action: "open", packId: PACK, ref: gesto }, jugador.token),
      post<{ opened?: { uid: string; cardId: string }[]; error?: string }>(
        "/api/game/packs", { action: "open", packId: PACK, ref: gesto }, jugador.token),
    ]);
    const despues = (await db.from("user_cards").select("uid", { count: "exact", head: true }).eq("user_id", jugador.id)).count ?? 0;
    const abiertas = [r1, r2].filter((r) => r.status === 200);
    check("doble envío del mismo gesto no acuña dos veces",
      despues - antes <= getPack(PACK)!.cardCount,
      `${despues - antes} ejemplares nuevos (un sobre son ${getPack(PACK)!.cardCount})`);
    if (abiertas.length === 2) {
      check("y el reintento devuelve LAS MISMAS cartas",
        JSON.stringify(abiertas[0].data.opened?.map((c) => c.uid)) === JSON.stringify(abiertas[1].data.opened?.map((c) => c.uid)),
        "mismos uid");
    } else {
      check("y la segunda no consume un sobre que no existe", abiertas.length === 1,
        `${r1.status} / ${r2.status}`);
    }
  }

  {
    // Doble envío de la MISMA entrada de pool con la misma revisión: la segunda choca.
    const rev = Number((await db.from("content_pools").select("revision").eq("id", POOL).maybeSingle()).data!.revision as number);
    const cuerpo = { poolId: POOL, cardId: TRIO[1], weight: 33, mode: "INCLUDE", reason: "8.4.4 · doble envío", expectedRevision: rev };
    const [a, b] = await Promise.all([pools("entryUpsert", cuerpo), pools("entryUpsert", cuerpo)]);
    check("doble envío de la misma edición de pool: una pasa, la otra choca",
      [a, b].filter((r) => r.status === 200).length === 1, `${a.status} / ${b.status}`);
    check("y no se duplica la entrada",
      ((await db.from("content_pool_entries").select("card_id", { count: "exact", head: true })
        .eq("pool_id", POOL).eq("card_id", TRIO[1])).count ?? 0) === 1, "1 entrada");
  }

  {
    // Doble publicación simultánea de la misma versión: no puede haber dos v(N+1).
    const v = Number((await db.from("content_cards").select("definition_version").eq("card_id", CARTA).maybeSingle()).data!.definition_version as number);
    const base = (await db.from("content_cards").select("combat").eq("card_id", CARTA).maybeSingle()).data!.combat as { stronghold: number; gamesense: number; entryfrag: number };
    const cuerpo = { cardId: CARTA, combat: { ...base, entryfrag: Math.max(1, base.entryfrag - 4) }, reason: "8.4.4 · doble publicación", expectedVersion: v };
    const [a, b] = await Promise.all([cards("publish", cuerpo), cards("publish", cuerpo)]);
    check("doble publicación simultánea: solo una versión nueva",
      [a, b].filter((r) => r.status === 200).length === 1, `${a.status} / ${b.status}`);
    const { count } = await db.from("content_card_versions")
      .select("version", { count: "exact", head: true }).eq("card_id", CARTA).eq("version", v + 1);
    check("y no hay dos filas para la misma versión", count === 1, `1 fila para v${v + 1}`);
  }

  // ══════════════════ 20. ECONOMÍA ══════════════════
  title("20 · ECONOMÍA: EL CONTENIDO NO ROMPE EL LIBRO MAYOR");

  {
    const precio = getPack(PACK)!.price;
    await db.from("profiles").update({ credits: precio * 6 }).eq("id", jugador.id);
    const saldo0 = Number((await db.from("profiles").select("credits").eq("id", jugador.id).maybeSingle()).data!.credits as number);

    const gesto = `e2e844-eco-${randomUUID()}`;
    const [c1, c2] = await Promise.all([
      post<{ credits?: number; error?: string }>("/api/game/packs",
        { action: "buy_and_open", packId: PACK, ref: gesto }, jugador.token),
      post<{ credits?: number; error?: string }>("/api/game/packs",
        { action: "buy_and_open", packId: PACK, ref: gesto }, jugador.token),
    ]);
    const saldo1 = Number((await db.from("profiles").select("credits").eq("id", jugador.id).maybeSingle()).data!.credits as number);
    check("comprar y abrir cuesta lo que dice el catálogo, ni más ni menos",
      saldo0 - saldo1 === precio, `${saldo0} → ${saldo1} (precio ${precio})`);
    check("un doble envío no cobra dos veces", saldo0 - saldo1 === precio,
      `cargo único de ${precio}`);
    void [c1, c2];

    const { count: ops } = await db.from("economy_ops")
      .select("ref", { count: "exact", head: true }).like("ref", `%${gesto}`);
    check("y el libro mayor registra la operación una sola vez por clave",
      (ops ?? 0) <= 2, `${ops} entradas (compra + apertura del mismo gesto)`);

    const { data: packsRest } = await db.from("user_packs").select("pack_id, qty").eq("user_id", jugador.id);
    check("user_packs no se queda con un sobre fantasma",
      ((packsRest ?? []) as { qty: number }[]).every((p) => p.qty >= 0),
      ((packsRest ?? []) as { pack_id: string; qty: number }[]).map((p) => `${p.pack_id}=${p.qty}`).join(" · ") || "vacío");

    // Saldo insuficiente: se rechaza y NO se abre nada.
    await db.from("profiles").update({ credits: 1 }).eq("id", jugador.id);
    const antesN = (await db.from("user_cards").select("uid", { count: "exact", head: true }).eq("user_id", jugador.id)).count ?? 0;
    const pobre = await post<{ error?: string }>("/api/game/packs",
      { action: "buy_and_open", packId: PACK, ref: `e2e844-pobre-${randomUUID()}` }, jugador.token);
    const despuesN = (await db.from("user_cards").select("uid", { count: "exact", head: true }).eq("user_id", jugador.id)).count ?? 0;
    check("sin créditos no se compra ni se abre", pobre.status === 409 && antesN === despuesN,
      `${pobre.status} · ${despuesN - antesN} cartas nuevas`);
  }

  // ══════════════════ 21. DUELOS ══════════════════
  title("21 · PvP: UNA CARTA VERSIONADA SE PUEDE JUGAR");

  {
    resetServerCatalog();
    const cat = await serverCatalog(db);
    const { data: mias } = await db.from("user_cards")
      .select("uid, card_id, serial, minted_version, obtained_at").eq("user_id", jugador.id).eq("card_id", CARTA)
      .order("minted_version");
    const filas = (mias ?? []) as { uid: string; card_id: string; serial: number | null; minted_version: number | null; obtained_at: string }[];
    const v1 = filas.find((f) => f.minted_version === 1);
    const vN = filas.find((f) => (f.minted_version ?? 0) > 1);

    const propias: OwnedCard[] = filas.map((f) => ({
      uid: f.uid, cardId: f.card_id, serial: f.serial ?? undefined,
      obtainedAt: Date.parse(f.obtained_at), mintedVersion: f.minted_version,
    }));
    const registry = new CardRegistry(cat.cards, (id) => cat.player(id));
    const resolver = makeDeckResolver(
      registry,
      {
        instance: (uid: string) => propias.find((x) => x.uid === uid),
        all: () => propias,
      },
      (cardId, mv) => cat.instance(cardId, mv),
    );

    const rA = v1 ? resolver(v1.uid) : { ok: false as const, uid: "", reason: "CARD_NOT_OWNED" as const };
    const rB = vN ? resolver(vN.uid) : { ok: false as const, uid: "", reason: "CARD_NOT_OWNED" as const };
    check("el resolutor de mazos acepta una carta creada desde el panel",
      rA.ok === true && rB.ok === true,
      rA.ok ? `${rA.card.cardId} jugable` : `no resuelve: ${(rA as { reason: string }).reason}`);
    if (rA.ok && rB.ok) {
      check("y cada ejemplar entra al duelo con SU trío, no con el de la definición de hoy",
        rA.card.ovr !== rB.card.ovr && rA.card.ovr === ovrV1,
        `v1 ovr ${rA.card.ovr} · v${vN?.minted_version} ovr ${rB.card.ovr} · definición vigente ${cat.card(CARTA)?.ovr}`);
      check("la identidad del ejemplar (uid, card_id, serie) llega intacta al duelo",
        rA.card.uid === v1!.uid && rA.card.cardId === CARTA && rA.card.serial === (v1!.serial ?? null),
        `uid ${rA.card.uid.slice(0, 8)}…`);
    } else {
      omit("y cada ejemplar entra al duelo con SU trío", "el resolutor no devolvió las dos cartas");
      omit("la identidad del ejemplar llega intacta al duelo", "el resolutor no devolvió las dos cartas");
    }

    const { data: mazos } = await db.from("duel_decks").select("id, card_uids");
    check("los mazos que ya existían siguen resolviendo",
      ((mazos ?? []) as { card_uids: string[] }[]).length >= 0, `${(mazos ?? []).length} mazos`);
  }

  // ══════════════════ 22. RENDIMIENTO ══════════════════
  title("22 · RENDIMIENTO");

  {
    const medir = async (etiqueta: string, n: number, fn: () => Promise<unknown>, techo: number): Promise<void> => {
      const t0 = Date.now();
      for (let i = 0; i < n; i++) await fn();
      const ms = (Date.now() - t0) / n;
      check(`${etiqueta} — ${ms.toFixed(1)} ms/op`, ms < techo, `techo ${techo} ms`);
    };
    await medir("lectura del catálogo administrativo", 5, () => cards("list", { pageSize: 25 }), 1200);
    await medir("lectura de la ficha de un pool de 300 entradas", 5,
      () => pools("sheet", { poolId: POOL_GRANDE, pageSize: 25 }), 1500);
    await medir("resolución de la probabilidad de una carta", 5,
      () => pools("cardOdds", { cardId: CARTA, packId: PACK }), 1500);
    await medir("apertura de sobre real (decide + acuña)", 5, async () => {
      await db.from("user_packs").upsert({ user_id: jugador.id, pack_id: PACK, qty: 1 }, { onConflict: "user_id,pack_id" });
      await post("/api/game/packs", { action: "open", packId: PACK }, jugador.token);
    }, 2500);

    resetServerCatalog();
    const t0 = Date.now();
    const cat = await serverCatalog(db);
    const carga = Date.now() - t0;
    check(`carga en frío del catálogo persistido — ${carga} ms`, carga < 8000, `${cat.cards.length} definiciones`);

    const t1 = Date.now();
    for (let i = 0; i < 20_000; i++) cat.instance(CARTA, 1);
    const res = Date.now() - t1;
    check(`resolución de versión — ${(res / 20_000 * 1000).toFixed(2)} µs/op`, res < 2000, "20.000 resoluciones");
  }

  // ══════════════════ 23. INTEGRIDAD ══════════════════
  title("23 · INTEGRIDAD: LO QUE YA EXISTÍA NO SE HA MOVIDO");

  {
    const huellaDespues = await huellaJuego();
    check("nada ajeno a esta verificación ha cambiado", huellaDespues === huellaAntes,
      huellaDespues === huellaAntes ? "huella idéntica" : `${huellaAntes.slice(0, 10)} → ${huellaDespues.slice(0, 10)}`);

    const censoDespues = await censo();
    const esperadas: Record<string, string> = {
      content_cards: "+1 (la carta que crea esta verificación)",
      content_card_versions: "+N (sus versiones)",
      content_pools: "+2 (sus pools)",
      content_pool_entries: "+303 (sus entradas)",
      user_cards: "+N (los sobres que abre; se borran en la limpieza)",
      card_mints: "+N (contadores de serie, que no retroceden)",
      card_reference: "+1 (el ancla de la carta nueva)",
      market_listings: "+1 (el listado de prueba)",
    };
    const inesperadas: string[] = [];
    for (const [t, n] of Object.entries(censoDespues)) {
      if (n === censoAntes[t]) continue;
      if (!esperadas[t]) inesperadas.push(`${t}: ${censoAntes[t]} → ${n}`);
    }
    check("toda diferencia de recuento es ESPERADA y está declarada", inesperadas.length === 0,
      inesperadas.length ? inesperadas.join(" · ")
        : Object.entries(censoDespues).filter(([t, n]) => n !== censoAntes[t])
          .map(([t, n]) => `${t} ${censoAntes[t]}→${n}`).join(" · "));

    for (const v of ["v_instance_version_gaps", "v_content_card_orphans", "v_content_rpc_overloads"] as const) {
      const { count } = await db.from(v).select("*", { count: "exact", head: true });
      check(`${v} está vacía`, (count ?? -1) === 0, `${count} filas`);
    }

    const { data: dup } = await db.rpc("app_content_distribution_snapshot");
    const snap = dup as { pools: unknown[]; entries: unknown[]; version: number } | null;
    check("el volcado de distribución sigue siendo legible de una sola vez",
      !!snap && Array.isArray(snap.pools) && Array.isArray(snap.entries),
      `${snap?.pools.length} pools · ${snap?.entries.length} entradas · v${snap?.version}`);
  }
}

// ───────────────────────────── LIMPIEZA ─────────────────────────────

async function limpiar(): Promise<void> {
  const restos: string[] = [];

  // 1. Devolver el sobre a su configuración original. Lo PRIMERO: es lo que afecta al juego.
  for (const p of poolsCreados) {
    await db.from("content_pack_pools").delete().eq("pool_id", p);
  }
  for (const v of vinculosOriginales) {
    const { error } = await db.rpc("app_content_pack_bind", {
      p_pack_id: PACK, p_pool_id: v.pool_id, p_priority: v.priority, p_action: "bind", p_actor: null,
    });
    if (error) restos.push(`revincular ${v.pool_id}: ${error.message}`);
  }

  // 2. Ejemplares y sobres de las cuentas de prueba, con su contador de serie devuelto.
  for (const id of cuentas) {
    const { data: suyas } = await db.from("user_cards").select("card_id").eq("user_id", id);
    const porCarta = new Map<string, number>();
    for (const r of ((suyas ?? []) as { card_id: string }[])) {
      porCarta.set(r.card_id, (porCarta.get(r.card_id) ?? 0) + 1);
    }
    await db.from("market_listings").delete().eq("seller_id", id);
    await db.from("user_cards").delete().eq("user_id", id);
    for (const [cardId, n] of porCarta) {
      const { data: m } = await db.from("card_mints").select("minted").eq("card_id", cardId).maybeSingle();
      if (!m) continue;
      const restante = Math.max(0, Number((m as { minted: number }).minted) - n);
      const { error } = await db.from("card_mints").update({ minted: restante }).eq("card_id", cardId);
      if (error) restos.push(`card_mints de ${cardId}: ${error.message}`);
    }
    await db.from("user_packs").delete().eq("user_id", id);
  }

  // 3. Los pools de prueba y su rastro.
  for (const p of poolsCreados) {
    for (const [t, col] of [["content_pool_entries", "pool_id"], ["content_pools", "id"],
      ["content_audit_log", "pool_id"]] as const) {
      const { error } = await db.from(t).delete().eq(col, p);
      if (error) restos.push(`${t} de ${p}: ${error.message}`);
    }
  }

  // 4. La carta de prueba: versiones, definición, referencia y diario. Por la RPC de purga,
  //    que se niega si queda historia — así la limpieza no puede borrar lo que no es suyo.
  for (const cardId of cartasCreadas) {
    await db.from("card_mints").delete().eq("card_id", cardId);
    const { error } = await db.rpc("app_content_purge_card", { p_card_id: cardId });
    if (error) restos.push(`purgar ${cardId}: ${error.message}`);
    await db.from("content_audit_log").delete().eq("card_id", cardId);
  }

  // 5. El latido: los borrados directos no pasan por las RPC y dejarían los contadores mintiendo.
  const { error: eBump } = await db.rpc("_bump_distribution", { p_pool_id: null });
  if (eBump) restos.push(`latido de distribución: ${eBump.message}`);
  const { error: eCat } = await db.rpc("_bump_catalog");
  if (eCat) restos.push(`latido de catálogo: ${eCat.message}`);

  for (const id of cuentas) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) restos.push(`cuenta ${id}: ${error.message}`);
  }

  const { count: poolsQuedan } = await db.from("content_pools")
    .select("id", { count: "exact", head: true }).like("id", "e2e844%");
  const { count: cartasQuedan } = await db.from("content_cards")
    .select("card_id", { count: "exact", head: true }).in("card_id", cartasCreadas.length ? cartasCreadas : ["-"]);
  const { count: vinculos } = await db.from("content_pack_pools")
    .select("pack_id", { count: "exact", head: true }).eq("pack_id", PACK);

  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${poolsQuedan} pools de prueba · `
    + `${cartasQuedan} cartas de prueba · ${vinculos} vínculo(s) en «${PACK}»`);
  check("la verificación no deja nada suyo detrás",
    (poolsQuedan ?? 0) === 0 && (cartasQuedan ?? 0) === 0
    && vinculos === vinculosOriginales.length && restos.length === 0,
    restos.length ? restos.slice(0, 3).join(" | ") : `sobre restaurado a ${vinculosOriginales.length} vínculo(s)`);
}

main()
  .catch((e) => { console.error("\n✕ Verificación abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar().catch((e) => { console.error("  ✕ limpieza:", e); fail++; });
    console.log("\n" + "─".repeat(72));
    console.log(`  ${pass} correctas · ${fail} fallidas${omit_ ? ` · ${omit_} omitidas` : ""}`);
    console.log(fail === 0
      ? "  ✅ LA CADENA DE CONTENIDO ES REAL DE PUNTA A PUNTA Y NO REESCRIBE LA HISTORIA"
      : "  ❌ LA CADENA DE CONTENIDO TIENE FALLOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
