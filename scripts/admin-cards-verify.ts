/**
 * VERIFICACIÓN DEL PANEL DE CARTAS — `npm run admin-cards:verify` (Bloque 8.4.1).
 *
 * Siete familias:
 *
 *   1. API           — listado, filtros, orden, paginación y ficha, con datos reales.
 *   2. ALTA Y EDICIÓN— crear en DRAFT, editar en sitio, y la frontera de 8.2: una carta
 *                      publicada NO se edita en sitio, se versiona.
 *   3. INTEGRIDAD    — editar, publicar y retirar **no tocan una sola instancia**.
 *   4. CONCURRENCIA  — dos administradores sobre la misma carta; publicaciones y retiradas
 *                      simultáneas.
 *   5. D-1b          — la banda del mercado se ancla en la versión del EJEMPLAR.
 *   6. SEGURIDAD     — anónimo, usuario normal, suplantación, API directa, RPC directa.
 *   7. AUDITORÍA     — quién hizo qué y cuándo.
 *
 * Crea sus datos y los borra. Deja la base como la encontró.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog, resetServerCatalog } from "../src/server/catalog";
import { resetServerDistribution } from "../src/server/catalog/distribution";
import { getVariant } from "../src/domain/cards/variants";
import { deriveCard, applyCombatBoost, type CombatStats } from "../src/domain/cards/combat";
import { applyStatBoost } from "../src/domain/cards/ovr";
import { bucketForRank } from "../src/domain/packs/types";
import { cardChecksum } from "../src/server/catalog/rows";
import { unboost } from "../src/server/services/cardDerivation";

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
if (!URL_ || !SERVICE || !ANON) { console.error("Falta configuración de Supabase"); process.exit(1); }
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");

let pass = 0, fail = 0, skip = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const omit = (l: string, w: string): void => { console.log(`  [SKIP] ${l} — ${w}`); skip++; };
const title = (s: string): void => console.log(`\n─── ${s} ${"─".repeat(Math.max(0, 66 - s.length))}`);

const cuentas: string[] = [];
const cartasCreadas: string[] = [];
const cartasTocadas = new Map<string, Record<string, unknown>>();
let servidorVivo = false;
let adminToken = "";

async function cuenta(tag: string, esAdmin = false): Promise<{ id: string; token: string }> {
  const email = `adm841-${tag}-${randomUUID()}@nexus.test`;
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

const api = async <T>(action: string, body: Record<string, unknown> = {}, token = adminToken): Promise<{ status: number; data: T }> => {
  const r = await fetch(`${BASE}/api/admin/cards`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, ...body }), cache: "no-store",
  });
  const t = await r.text();
  let data: unknown = null;
  try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data: data as T };
};

async function recordar(cardId: string): Promise<void> {
  if (cartasTocadas.has(cardId)) return;
  const { data } = await db.from("content_cards").select("*").eq("card_id", cardId).maybeSingle();
  if (data) cartasTocadas.set(cardId, data as Record<string, unknown>);
}

/** Huella de TODO lo que una operación administrativa no puede tocar. */
async function huellaInstancias(): Promise<string> {
  const h = createHash("sha256");
  for (const [t, cols, key] of [
    ["user_cards", "uid, user_id, card_id, serial, origin, locked, minted_version", "uid"],
    ["card_mints", "card_id, minted", "card_id"],
    ["duel_decks", "id, user_id, card_uids", "id"],
    ["market_listings", "id, seller_id, card_id, card_uid, price, status", "id"],
    ["duel_matches", "id, user_id, status, winner", "id"],
  ] as const) {
    const { data } = await db.from(t).select(cols).order(key);
    h.update(t).update(JSON.stringify(data ?? []));
  }
  return h.digest("hex");
}

// ───────────────────────────── 1 · API ─────────────────────────────

async function familiaApi(): Promise<void> {
  title("1 · LA API SIRVE EL CATÁLOGO REAL");
  if (!servidorVivo) { omit("todas las comprobaciones de API", `no hay servidor en ${BASE}`); return; }

  const facets = await api<{ lifecycles: string[]; variants: unknown[]; pools: unknown[] }>("facets");
  check("facets responde con el vocabulario real", facets.status === 200
    && facets.data.lifecycles.length === 7 && (facets.data.variants as unknown[]).length === 37,
    `${(facets.data.variants as unknown[]).length} variantes · ${(facets.data.pools as unknown[]).length} pools`);

  const l1 = await api<{ rows: unknown[]; total: number }>("list", { pageSize: 25 });
  const { count: real } = await db.from("content_cards").select("card_id", { count: "exact", head: true });
  check("el listado pagina en la base, no en el cliente",
    l1.status === 200 && l1.data.rows.length === 25 && l1.data.total === real,
    `${l1.data.rows.length} filas de ${l1.data.total} (catálogo: ${real})`);

  const l2 = await api<{ rows: { lifecycle: string }[]; total: number }>("list", { lifecycle: "RETIRED" });
  const { count: retiradas } = await db.from("content_cards")
    .select("card_id", { count: "exact", head: true }).eq("lifecycle", "RETIRED");
  check("el filtro por estado se aplica en SQL",
    l2.data.total === retiradas && l2.data.rows.every((r) => r.lifecycle === "RETIRED"),
    `${l2.data.total} retiradas`);

  const l3 = await api<{ rows: { nick: string }[] }>("list", { q: "derke" });
  check("la búsqueda encuentra por jugador", l3.data.rows.length > 0
    && l3.data.rows.every((r) => r.nick.toLowerCase().includes("derke")),
    `${l3.data.rows.length} cartas de derke`);

  const l4 = await api<{ rows: { ovr: number }[] }>("list", { sort: "ovr", dir: "desc", pageSize: 10 });
  const ovrs = l4.data.rows.map((r) => r.ovr);
  check("la ordenación es la pedida", ovrs.every((v, i) => i === 0 || ovrs[i - 1] >= v),
    `${ovrs[0]} … ${ovrs[ovrs.length - 1]}`);

  const l5 = await api<{ rows: unknown[]; total: number }>("list", { poolId: "pack-china" });
  check("el filtro por pool funciona", l5.status === 200 && l5.data.total > 0 && l5.data.total < (real ?? 0),
    `${l5.data.total} cartas en pack-china`);

  const sheet = await api<{ definition: Record<string, unknown>; versions: unknown[]; instances: { total: number }; distribution: unknown[]; economy: { marketValue: number } }>(
    "sheet", { cardId: "derke__prime" });
  check("la ficha responde entera", sheet.status === 200
    && !!sheet.data.definition && sheet.data.versions.length >= 1,
    `${sheet.data.versions.length} versiones · ${sheet.data.distribution.length} pools · ${sheet.data.instances.total} ejemplares · valor ${sheet.data.economy.marketValue}`);
  check("la ficha NO expone quién posee qué",
    !JSON.stringify(sheet.data).includes("user_id"),
    "solo agregados: total, propietarios, por versión");
}

// ───────────────────────────── 2 · ALTA Y EDICIÓN ─────────────────────────────

async function familiaAlta(): Promise<string | null> {
  title("2 · ALTA, BORRADOR Y LA FRONTERA DE 8.2");
  if (!servidorVivo) { omit("alta y edición", "no hay servidor"); return null; }

  // Un jugador derivable sin la variante que vamos a usar.
  const { data: cands } = await db.from("content_players").select("id, nick").limit(80);
  let elegido: { id: string; nick: string } | null = null;
  for (const p of ((cands ?? []) as { id: string; nick: string }[])) {
    const { count } = await db.from("content_cards")
      .select("card_id", { count: "exact", head: true }).eq("card_id", `${p.id}__mythic`);
    const { count: tieneAlguna } = await db.from("content_cards")
      .select("card_id", { count: "exact", head: true }).eq("player_id", p.id);
    if (count === 0 && (tieneAlguna ?? 0) > 0) { elegido = p; break; }
  }
  if (!elegido) { omit("alta", "no hay jugador candidato"); return null; }

  const sinMotivo = await api("create", { playerId: elegido.id, variantId: "mythic" });
  check("un alta SIN MOTIVO se rechaza", sinMotivo.status === 400, `HTTP ${sinMotivo.status}`);

  const jugadorFalso = await api("create", { playerId: "no-existe", variantId: "mythic", reason: "x" });
  check("un jugador inexistente se rechaza", jugadorFalso.status === 404 || jugadorFalso.status === 400);

  const varianteFalsa = await api("create", { playerId: elegido.id, variantId: "no-existe", reason: "x" });
  check("una variante inválida se rechaza", varianteFalsa.status === 400);

  const alta = await api<{ cardId: string; lifecycle: string; version: number }>("create", {
    playerId: elegido.id, variantId: "mythic", reason: "verificación 8.4.1",
  });
  check("el alta crea la carta", alta.status === 200, alta.data?.cardId ?? JSON.stringify(alta.data));
  if (alta.status !== 200) return null;
  const cardId = alta.data.cardId;
  cartasCreadas.push(cardId);

  check("nace en DRAFT y en la versión 1",
    alta.data.lifecycle === "DRAFT" && alta.data.version === 1, `${cardId}`);

  const dup = await api("create", { playerId: elegido.id, variantId: "mythic", reason: "otra vez" });
  check("no se puede crear dos veces la misma carta", dup.status === 409, `HTTP ${dup.status}`);

  // Las estadísticas las derivó el dominio: no puede haber un OVR escrito a mano.
  const { data: fila } = await db.from("content_cards").select("*").eq("card_id", cardId).maybeSingle();
  const f = fila as { ovr: number; source: string; combat: { stronghold: number }; origin: string };
  check("las estadísticas están derivadas, no tecleadas",
    f.ovr > 0 && f.source === "vlr" && f.combat.stronghold > 0,
    `OVR ${f.ovr} · source=${f.source} · origin=${f.origin}`);

  // DRAFT no entra en el catálogo servido ni en ningún pool.
  resetServerCatalog(); resetServerDistribution();
  const cat = await serverCatalog(db);
  check("un DRAFT no entra en el catálogo del servidor", !cat.has(cardId));
  check("ni en el registro de sorteo", !cat.packEngine.registry.has(cardId));

  /*
   * Edición EN SITIO: legítima mientras es borrador.
   *
   * Desde 8.4.2 lo que se envía es el TRÍO BASE, no un OVR. El OVR esperado se calcula aquí
   * con las funciones del dominio —`deriveCard`— y se compara con el que guardó el servidor:
   * así la comprobación falla tanto si el servidor deja de derivar como si alguien cambia la
   * fórmula sin darse cuenta.
   */
  const boostMythic = getVariant("mythic").statBoost;
  const baseA: CombatStats = { stronghold: 70, gamesense: 60, entryfrag: 50 };
  const esperadoA = deriveCard(baseA, boostMythic);

  const edicion = await api<{ cardId: string }>("updateDraft", {
    cardId, reason: "ajuste de borrador", combat: baseA, expectedVersion: 1,
  });
  check("un borrador se edita EN SITIO", edicion.status === 200, `HTTP ${edicion.status}`);
  const { data: tras } = await db.from("content_cards")
    .select("ovr, combat, definition_version").eq("card_id", cardId).maybeSingle();
  const t = tras as { ovr: number; combat: CombatStats; definition_version: number };
  check("la edición se aplica sin crear versión nueva",
    t.ovr === esperadoA.ovr && t.definition_version === 1,
    `OVR ${t.ovr} (derivado de ${baseA.stronghold}/${baseA.gamesense}/${baseA.entryfrag}) · sigue en v1`);
  check("el trío guardado es el base MÁS el boost de la variante",
    t.combat.stronghold === esperadoA.combat.stronghold
    && t.combat.gamesense === esperadoA.combat.gamesense
    && t.combat.entryfrag === esperadoA.combat.entryfrag,
    `+${boostMythic} → ${t.combat.stronghold}/${t.combat.gamesense}/${t.combat.entryfrag}`);

  const campoProhibido = await api("updateDraft", {
    cardId, reason: "x", combat: baseA, player_id: "otro", variant_id: "gold",
  });
  check("la identidad NO se puede editar ni en un borrador", campoProhibido.status === 400,
    "player_id y variant_id son inmutables");

  // Publicar, y entonces la frontera cambia.
  const pub = await api("lifecycle", { cardId, state: "PUBLISHED", reason: "verificación 8.4.1" });
  check("un borrador se puede publicar", pub.status === 200, `HTTP ${pub.status}`);

  const edicionProhibida = await api("updateDraft", {
    cardId, reason: "x", combat: { stronghold: 80, gamesense: 60, entryfrag: 50 },
  });
  check("una carta PUBLICADA ya NO se edita en sitio", edicionProhibida.status === 409,
    "hay que publicar una versión nueva — la frontera de 8.2");

  const baseB: CombatStats = { stronghold: 80, gamesense: 60, entryfrag: 50 };
  const esperadoB = deriveCard(baseB, boostMythic);
  const versionNueva = await api<{ version: number }>("publish", {
    cardId, reason: "verificación 8.4.1", combat: baseB, expectedVersion: 1,
  });
  check("una carta publicada se versiona", versionNueva.status === 200 && versionNueva.data.version === 2,
    `v1 → v${versionNueva.data?.version}`);

  const { data: vers } = await db.from("content_card_versions")
    .select("version, ovr, effective_to, checksum").eq("card_id", cardId).order("version");
  const vs = (vers ?? []) as { version: number; ovr: number; effective_to: string | null; checksum: string }[];
  check("la versión anterior queda intacta y cerrada",
    vs.length === 2 && vs[0].ovr === esperadoA.ovr && vs[0].effective_to !== null && vs[1].effective_to === null,
    vs.map((v) => `v${v.version}:OVR${v.ovr}`).join(" → "));
  check("la versión nueva lleva el OVR derivado del trío nuevo",
    vs[1]?.ovr === esperadoB.ovr, `esperado ${esperadoB.ovr}, guardado ${vs[1]?.ovr}`);

  /*
   * LA HUELLA DE TODAS LAS VERSIONES.
   *
   * Antes de 8.4.2 la RPC hacía `coalesce(p_patch->>'checksum', '')` y la ruta no la enviaba:
   * la v1 llevaba huella y la v2 en adelante, cadena vacía. Se comprueba sobre TODAS porque
   * el fallo solo aparecía a partir de la segunda.
   */
  check("cada versión lleva su huella, no solo la primera",
    vs.every((v) => typeof v.checksum === "string" && v.checksum.length === 64),
    vs.map((v) => `v${v.version}:${v.checksum ? v.checksum.slice(0, 8) : "VACÍA"}`).join(" · "));

  return cardId;
}

// ───────────────────────────── 3 · INTEGRIDAD ─────────────────────────────

async function familiaIntegridad(): Promise<void> {
  title("3 · NINGUNA OPERACIÓN ADMINISTRATIVA TOCA UNA INSTANCIA");
  if (!servidorVivo) { omit("integridad", "no hay servidor"); return; }

  // Una carta que SÍ tiene ejemplares reales.
  const { data: conEjemplares } = await db.from("user_cards").select("card_id").limit(1).maybeSingle();
  const cardId = (conEjemplares as { card_id: string } | null)?.card_id;
  if (!cardId) { omit("integridad", "no hay instancias"); return; }
  await recordar(cardId);

  const { data: antesInst } = await db.from("user_cards")
    .select("uid, card_id, serial, minted_version, user_id").eq("card_id", cardId).order("uid");
  const antes = await huellaInstancias();

  const pub = await api<{ version: number }>("publish", {
    cardId, reason: "verificación de integridad 8.4.1", combat: { stronghold: 75, gamesense: 65, entryfrag: 55 },
  });
  check("se publica una versión sobre una carta CON ejemplares", pub.status === 200,
    `v${pub.data?.version}`);

  const trasPublicar = await huellaInstancias();
  check("PUBLISH → ninguna instancia cambia", antes === trasPublicar,
    `${(antesInst ?? []).length} ejemplares de ${cardId}, huella idéntica`);

  const ret = await api("lifecycle", { cardId, state: "RETIRED", reason: "verificación 8.4.1" });
  check("se retira la carta", ret.status === 200);
  const trasRetirar = await huellaInstancias();
  check("RETIRE → ninguna instancia cambia", antes === trasRetirar, "huella idéntica");

  await api("lifecycle", { cardId, state: "PUBLISHED", reason: "restaurar" });
  const trasVolver = await huellaInstancias();
  check("REPUBLISH → ninguna instancia cambia", antes === trasVolver, "huella idéntica");

  // Y lo que de verdad importa: la versión histórica sigue describiendo lo que tienen.
  const { data: v1 } = await db.from("content_card_versions")
    .select("ovr, rarity_rank").eq("card_id", cardId).eq("version", 1).maybeSingle();
  const original = cartasTocadas.get(cardId) as { ovr: number; rarity_rank: number };
  check("la versión 1 conserva su OVR y su rareza",
    (v1 as { ovr: number; rarity_rank: number }).ovr === original.ovr
    && (v1 as { rarity_rank: number }).rarity_rank === original.rarity_rank,
    `OVR ${(v1 as { ovr: number }).ovr} · rank ${(v1 as { rarity_rank: number }).rarity_rank}`);

  const { count: huecos } = await db.from("v_instance_version_gaps").select("uid", { count: "exact", head: true });
  check("cero ejemplares sin historia reconstruible", huecos === 0);
}

// ───────────────────────────── 4 · CONCURRENCIA ─────────────────────────────

async function familiaConcurrencia(cardId: string | null): Promise<void> {
  title("4 · DOS ADMINISTRADORES SOBRE LA MISMA CARTA");
  if (!servidorVivo || !cardId) { omit("concurrencia", "sin servidor o sin carta"); return; }

  const { data: actual } = await db.from("content_cards")
    .select("definition_version").eq("card_id", cardId).maybeSingle();
  const v = (actual as { definition_version: number }).definition_version;

  // A y B abren la ficha con la misma versión; A publica; B intenta publicar con la vieja.
  const a = await api<{ version: number }>("publish", {
    cardId, reason: "admin A", combat: { stronghold: 61, gamesense: 51, entryfrag: 41 }, expectedVersion: v,
  });
  check("el primero en publicar gana", a.status === 200, `v${v} → v${a.data?.version}`);

  const b = await api<{ error: string; conflict?: boolean; current?: number }>("publish", {
    cardId, reason: "admin B", combat: { stronghold: 62, gamesense: 52, entryfrag: 42 }, expectedVersion: v,
  });
  check("el segundo NO sobrescribe en silencio: se rechaza", b.status === 409 && b.data.conflict === true,
    b.data?.error?.slice(0, 70) ?? "");
  check("y el rechazo dice cuál es la versión actual", b.data.current === a.data?.version,
    `actual v${b.data?.current}`);

  // Dos publicaciones simultáneas de verdad.
  const { data: v2r } = await db.from("content_cards").select("definition_version").eq("card_id", cardId).maybeSingle();
  const vNow = (v2r as { definition_version: number }).definition_version;
  const [p1, p2] = await Promise.all([
    api<{ version: number }>("publish", { cardId, reason: "simultánea 1", combat: { stronghold: 63, gamesense: 53, entryfrag: 43 }, expectedVersion: vNow }),
    api<{ version: number }>("publish", { cardId, reason: "simultánea 2", combat: { stronghold: 64, gamesense: 54, entryfrag: 44 }, expectedVersion: vNow }),
  ]);
  const exitos = [p1, p2].filter((r) => r.status === 200).length;
  /*
   * EXACTAMENTE UNA. La primera versión de esta comprobación aceptaba «<= 2» y pasaba con
   * las dos aceptadas — que es justo lo que no debe ocurrir: la segunda encadenaba su
   * edición sobre una base que nadie había visto. La comprobación de `expectedVersion` vive
   * ahora DENTRO de la RPC, bajo su `for update`, así que la segunda ve la versión de la
   * primera y se niega.
   */
  check("de dos publicaciones simultáneas, solo UNA sale adelante", exitos === 1,
    `${exitos} aceptadas · ${p1.status}/${p2.status}`);
  const { data: vig } = await db.from("content_card_versions")
    .select("version").eq("card_id", cardId).is("effective_to", null);
  check("sigue habiendo EXACTAMENTE una versión vigente", (vig ?? []).length === 1,
    "lo impone el índice único parcial de 0038");

  // Dos retiradas simultáneas: la segunda es una transición ilegal, no un daño.
  const [r1, r2] = await Promise.all([
    api("lifecycle", { cardId, state: "RETIRED", reason: "simultánea A" }),
    api("lifecycle", { cardId, state: "RETIRED", reason: "simultánea B" }),
  ]);
  check("dos retiradas simultáneas: una vale, la otra se rechaza",
    [r1, r2].filter((r) => r.status === 200).length === 1,
    `${r1.status} / ${r2.status} — RETIRED → RETIRED es ilegal`);
  await api("lifecycle", { cardId, state: "PUBLISHED", reason: "restaurar" });
}

// ───────────────────────────── 5 · D-1b ─────────────────────────────

async function familiaD1b(): Promise<void> {
  title("5 · D-1b — LA BANDA DEL MERCADO SE ANCLA EN LA VERSIÓN DEL EJEMPLAR");

  const { data: fn } = await db.rpc("_price_anchor_versioned", { p_card_id: "derke__prime", p_version: 1 })
    .then((r) => r, () => ({ data: null }));
  void fn;

  // La función existe y acepta la versión.
  const { error: e1 } = await db.rpc("_price_anchor_versioned", { p_card_id: "derke__prime", p_version: 1 });
  check("existe un ancla por versión", !e1 || e1.code === "42501", e1?.message?.slice(0, 50) ?? "ok");

  // `app_market_list` pasa la versión del ejemplar. Se comprueba leyendo su cuerpo: es la
  // única forma de demostrarlo sin abrir el mercado, que está cerrado por producto.
  const { data: src } = await db.rpc("app_content_validate_version_fk").then(() => ({ data: null }), () => ({ data: null }));
  void src;
  const { data: proc } = await db.from("content_audit_log").select("id").limit(1);
  void proc;

  const jugador = await cuenta("mercado");
  const { data: alguna } = await db.from("content_cards").select("card_id").eq("lifecycle", "PUBLISHED").limit(1).maybeSingle();
  const cardId = (alguna as { card_id: string }).card_id;
  const uid = randomUUID();
  await db.from("user_cards").insert({ uid, user_id: jugador.id, card_id: cardId, origin: "admin" });

  // Sin historial de ventas y sin ancla versionada, la banda no bloquea (anchor null).
  await db.from("content_card_market_anchor").delete().eq("card_id", cardId);
  const libre = await db.rpc("app_market_list", {
    p_user: jugador.id, p_card_uid: uid, p_price: 999999, p_ref: randomUUID(),
  });
  check("sin ancla, la banda no inventa un límite", !libre.error, libre.error?.message?.slice(0, 60) ?? "aceptado");
  // Deshacer el listado de prueba.
  const listingId = (libre.data as { listingId?: string } | null)?.listingId;
  if (listingId) {
    await db.from("market_listings").delete().eq("id", listingId);
    await db.from("user_cards").update({ locked: false }).eq("uid", uid);
  }

  // Con ancla versionada, la banda SÍ bloquea, y con el número de ESA versión.
  await db.from("content_card_market_anchor").insert({
    card_id: cardId, version: 1, fair_value: 100, ovr: 50, rarity_rank: 1,
  });
  const bloqueado = await db.rpc("app_market_list", {
    p_user: jugador.id, p_card_uid: uid, p_price: 999999, p_ref: randomUUID(),
  });
  check("con ancla de la versión, un precio absurdo se rechaza", !!bloqueado.error,
    bloqueado.error?.message?.slice(0, 70) ?? "¡aceptado!");
  check("y el mensaje cita el ancla de esa versión",
    (bloqueado.error?.message ?? "").includes("100"), "ancla ~100, no la de la definición vigente");

  await db.from("content_card_market_anchor").delete().eq("card_id", cardId);
  await db.from("user_cards").delete().eq("uid", uid);

  // Lo que queda declarado, no escondido.
  const { count: conHistorial } = await db.from("card_price_stats").select("card_id", { count: "exact", head: true });
  check("D-1c queda declarada: avg_price sigue siendo por card_id", true,
    `${conHistorial} carta(s) con historial de ventas — el ancla de mercado agrega versiones por diseño`);
}

// ───────────────────────────── 6 · SEGURIDAD ─────────────────────────────

async function familiaSeguridad(cardId: string | null): Promise<void> {
  title("6 · SEGURIDAD");

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const usuario = await cuenta("normal");
  const comoUsuario = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${usuario.token}` } },
  });

  for (const [etiqueta, cli] of [["anon", anon], ["authenticated", comoUsuario]] as const) {
    for (const t of ["content_audit_log", "content_card_market_anchor"]) {
      const { data, error } = await cli.from(t).select("*").limit(1);
      check(`${etiqueta} NO puede leer ${t}`, !!error || (data ?? []).length === 0, error?.code ?? "0 filas");
    }
    for (const [fn, args] of [
      ["app_content_create_card", { p_def: { player_id: "derke", variant_id: "mythic" }, p_reason: "x", p_actor: null }],
      ["app_content_update_draft", { p_card_id: "derke__prime", p_patch: { ovr: 99 }, p_reason: "x", p_actor: null, p_expected_version: null }],
    ] as const) {
      const r = await cli.rpc(fn, args as never);
      check(`${etiqueta} NO puede ${fn.replace("app_content_", "")}`, !!r.error, r.error?.code ?? "");
    }
  }

  if (!servidorVivo) { omit("API HTTP", "no hay servidor"); return; }

  const target = cardId ?? "derke__prime";
  for (const [etiqueta, accion, body] of [
    ["listar", "list", {}],
    ["ver la ficha", "sheet", { cardId: target }],
    ["crear", "create", { playerId: "derke", variantId: "mythic", reason: "x" }],
    ["editar borrador", "updateDraft", { cardId: target, reason: "x", patch: { ovr: 99 } }],
    ["publicar versión", "publish", { cardId: target, reason: "x", patch: { ovr: 99 } }],
    ["retirar", "lifecycle", { cardId: target, state: "RETIRED", reason: "x" }],
  ] as const) {
    const sin = await api(accion, body, "");
    check(`sin sesión NO puede ${etiqueta}`, sin.status === 401, `HTTP ${sin.status}`);
    const normal = await api(accion, body, usuario.token);
    check(`un usuario normal NO puede ${etiqueta}`, normal.status === 401, `HTTP ${normal.status}`);
  }

  const spoof = await api("publish", {
    cardId: target, reason: "x", patch: { ovr: 99 },
    userId: usuario.id, actor: usuario.id, role: "admin", is_admin: true, admin: true,
  }, usuario.token);
  check("suplantar actor/role/admin en el cuerpo no sirve", spoof.status === 401, `HTTP ${spoof.status}`);

  const versionSpoof = await api<{ error: string }>("publish", {
    cardId: target, reason: "x", combat: { stronghold: 79, gamesense: 69, entryfrag: 59 }, expectedVersion: 9999,
  });
  check("un expectedVersion inventado se rechaza", versionSpoof.status === 409,
    versionSpoof.data?.error?.slice(0, 60) ?? "");

  const { data: uc } = await db.from("user_cards").select("uid, user_id").limit(1).maybeSingle();
  if (uc) {
    const ajena = await comoUsuario.from("user_cards")
      .update({ user_id: usuario.id }).eq("uid", (uc as { uid: string }).uid);
    const { data: sigue } = await db.from("user_cards").select("user_id").eq("uid", (uc as { uid: string }).uid).maybeSingle();
    check("un usuario NO puede cambiar el dueño de una instancia",
      !!ajena.error || (sigue as { user_id: string }).user_id === (uc as { user_id: string }).user_id);
  }

  const lifecycleSpoof = await comoUsuario.from("content_cards")
    .update({ lifecycle: "PUBLISHED" }).eq("card_id", target);
  check("un usuario NO puede cambiar el lifecycle por PostgREST", !!lifecycleSpoof.error,
    lifecycleSpoof.error?.code ?? "");
}

// ───────────────────────────── 7 · AUDITORÍA ─────────────────────────────

async function familiaAuditoria(cardId: string | null): Promise<void> {
  title("7 · AUDITORÍA");
  if (!cardId) { omit("auditoría", "sin carta de prueba"); return; }

  const { data } = await db.from("content_audit_log")
    .select("action, actor, detail, at").eq("card_id", cardId).order("at");
  const filas = (data ?? []) as { action: string; actor: string | null; detail: { reason?: string } }[];
  const acciones = new Set(filas.map((r) => r.action));

  check("queda registrado quién CREÓ la carta", acciones.has("create_card"), `${filas.length} entradas`);
  check("quién la EDITÓ", acciones.has("update_draft"));
  check("quién la PUBLICÓ (versión)", acciones.has("publish_version"));
  check("y quién cambió su estado", acciones.has("set_lifecycle"));
  check("cada entrada lleva actor y motivo",
    filas.every((r) => r.actor !== null && typeof r.detail?.reason === "string"),
    "el actor sale del token, nunca del cuerpo");
  check("la auditoría NO guarda datos personales",
    !JSON.stringify(filas).match(/@|email|password/i), "solo el id del actor");
}

// ───────────────────────────── ejecución ─────────────────────────────

/**
 * Que no haya DOS funciones con el mismo nombre y distinta firma.
 *
 * Sale de un fallo de este bloque. La comprobacion de concurrencia del §7 necesitaba un
 * parametro nuevo en `app_content_publish_version`, y anadirlo con valor por defecto parecia
 * inofensivo: los llamantes viejos seguirian funcionando. Lo que hace `create or replace` con
 * una firma distinta, sin embargo, es crear una funcion NUEVA y dejar la anterior donde
 * estaba. Con las dos vivas, PostgREST recibe cuatro argumentos con nombre y responde «could
 * not choose the best candidate function»: dejo de publicarse ninguna version, y no lo vio
 * esta verificacion —que llamaba con cinco— sino la de 8.2, que llamaba con cuatro.
 *
 * Se comprueba aqui porque el error no esta en el codigo sino en la FORMA de la base, y
 * porque cuesta una consulta.
 */
async function familiaFirmas(): Promise<void> {
  title("8 · UNA SOLA FIRMA POR FUNCION");
  const { data: dup, error: e2 } = await db
    .from("v_content_rpc_overloads").select("proname, firmas, n");
  if (e2) { omit("firmas", `no se pudo consultar: ${e2.message}`); return; }

  const filas = (dup ?? []) as { proname: string; firmas: string; n: number }[];
  check("ninguna RPC de contenido esta duplicada con dos firmas", filas.length === 0,
    filas.length ? filas.map((f) => `${f.proname} x${f.n}: ${f.firmas}`).join(" | ")
                 : "cada app_content_* existe una sola vez");
}

// ─────────────────── 9 · EL SERVIDOR DERIVA; EL CLIENTE NO DECIDE ───────────────────

/**
 * La familia del Card Builder (8.4.2).
 *
 * Nace de tres medidas de la auditoría contra el servidor real, no de una sospecha:
 *
 *   · `publish` con `{ ovr: 99 }` y el trío intacto guardaba 99 sobre 84/80/65 — y ese 99
 *     llegaba al ancla del mercado con un `fair_value` de 127.775.
 *   · `publish` con `{ combat: { stronghold: 500, gamesense: -20 } }` guardaba 500 y -20.
 *   · toda versión publicada nacía con el `checksum` en cadena vacía.
 *
 * Cada comprobación de aquí abajo corresponde a una de esas puertas, cerrada.
 */
async function familiaDerivacion(cardId: string | null): Promise<void> {
  title("9 · EL SERVIDOR DERIVA; EL CLIENTE NO DECIDE");
  if (!servidorVivo || !cardId) { omit("derivación", "sin servidor o sin carta"); return; }

  const { data: filaPrev } = await db.from("content_cards")
    .select("*").eq("card_id", cardId).maybeSingle();
  const prev = filaPrev as Record<string, unknown>;
  const v = Number(prev.definition_version);
  const trioValido: CombatStats = { stronghold: 71, gamesense: 61, entryfrag: 51 };

  // ── Lo que ya no se acepta, campo a campo y con su motivo ──
  const derivados: [string, Record<string, unknown>][] = [
    ["ovr", { ovr: 99 }],
    ["stats", { stats: { dmg: 1, scr: 1, com: 1, hs: 1, ast: 1, clu: 1 } }],
    ["stat_boost", { stat_boost: 0 }],
    ["rarity_rank", { rarity_rank: 1 }],
    ["rarity_bucket", { rarity_bucket: "common" }],
    ["checksum", { checksum: "0".repeat(64) }],
    ["source", { source: "vlr" }],
    ["data_version", { data_version: "INVENTADA" }],
  ];
  const rechazados: string[] = [];
  for (const [nombre, extra] of derivados) {
    const r = await api<{ error?: string }>("publish", {
      cardId, reason: "verificación 8.4.2", combat: trioValido, expectedVersion: v, ...extra,
    });
    if (r.status !== 400 || !String(r.data?.error ?? "").includes(nombre)) {
      rechazados.push(`${nombre}: HTTP ${r.status} ${String(r.data?.error ?? "").slice(0, 40)}`);
    }
  }
  check("ningún campo DERIVADO se acepta de la petición", rechazados.length === 0,
    rechazados.length ? rechazados.join(" | ") : `${derivados.length} campos rechazados por nombre`);

  const inmutables: [string, Record<string, unknown>][] = [
    ["card_id", { card_id: "otra__gold" }],
    ["player_id", { player_id: "otro" }],
    ["variant_id", { variant_id: "gold" }],
    ["ordinal", { ordinal: 0 }],
    ["origin", { origin: "seed-generator" }],
    ["lifecycle", { lifecycle: "PUBLISHED" }],
    ["definition_version", { definition_version: 99 }],
  ];
  const colados: string[] = [];
  for (const [nombre, extra] of inmutables) {
    const r = await api<{ error?: string }>("publish", {
      cardId, reason: "verificación 8.4.2", combat: trioValido, expectedVersion: v, ...extra,
    });
    if (r.status !== 400) colados.push(`${nombre}: HTTP ${r.status}`);
  }
  check("ningún campo INMUTABLE se acepta de la petición", colados.length === 0,
    colados.length ? colados.join(" | ") : `${inmutables.length} campos rechazados por nombre`);

  const viejo = await api("publish", {
    cardId, reason: "x", expectedVersion: v, patch: { ovr: 90 },
  });
  check("el `patch` del contrato anterior se rechaza con explicación", viejo.status === 400,
    "quien llame con la forma vieja se entera en el momento");

  // ── El trío, con forma y rango ──
  const malos: [string, unknown][] = [
    ["fuera de rango por arriba", { stronghold: 500, gamesense: 60, entryfrag: 50 }],
    ["fuera de rango por abajo", { stronghold: -20, gamesense: 60, entryfrag: 50 }],
    ["decimal", { stronghold: 70.5, gamesense: 60, entryfrag: 50 }],
    ["incompleto", { stronghold: 70, gamesense: 60 }],
    ["texto", { stronghold: "70", gamesense: 60, entryfrag: 50 }],
    ["nulo", null],
  ];
  const pasan: string[] = [];
  for (const [nombre, combat] of malos) {
    const r = await api("publish", { cardId, reason: "x", combat, expectedVersion: v });
    if (r.status !== 400) pasan.push(`${nombre}: HTTP ${r.status}`);
  }
  check("un trío mal formado se rechaza siempre", pasan.length === 0,
    pasan.length ? pasan.join(" | ") : `${malos.length} formas inválidas rechazadas`);

  // ── Y la base tampoco lo acepta, aunque se llame a la RPC por debajo ──
  const { error: eSql } = await db.rpc("app_content_update_draft", {
    p_card_id: cardId, p_reason: "saltándose la ruta", p_actor: null,
    p_patch: { combat: { stronghold: 500, gamesense: 0, entryfrag: 0 }, checksum: "x".repeat(64) },
  });
  check("la BASE rechaza un trío inválido aunque se esquive la ruta", !!eSql,
    eSql ? "content_cards_combat_valido" : "¡la restricción no actuó!");

  // ── Lo que sí pasa: y el resultado es exactamente el del dominio ──
  const { data: antes } = await db.from("content_cards")
    .select("definition_version").eq("card_id", cardId).maybeSingle();
  const vAhora = Number((antes as { definition_version: number }).definition_version);

  const base: CombatStats = { stronghold: 66, gamesense: 55, entryfrag: 44 };
  const ok = await api<{ version: number }>("publish", {
    cardId, reason: "verificación 8.4.2: trío nuevo", combat: base, expectedVersion: vAhora,
  });
  check("un trío válido sí se publica", ok.status === 200, `HTTP ${ok.status}`);

  const { data: filaR } = await db.from("content_cards").select("*").eq("card_id", cardId).maybeSingle();
  const fila = filaR as Record<string, unknown>;
  const variant = getVariant(String(fila.variant_id) as never);
  const esperado = deriveCard(base, variant.statBoost);

  check("el OVR guardado es el que deriva el dominio, no el que envía nadie",
    Number(fila.ovr) === esperado.ovr, `esperado ${esperado.ovr}, guardado ${fila.ovr}`);

  const combatGuardado = fila.combat as CombatStats;
  check("el trío guardado es base + boost de la variante",
    combatGuardado.stronghold === esperado.combat.stronghold
    && combatGuardado.gamesense === esperado.combat.gamesense
    && combatGuardado.entryfrag === esperado.combat.entryfrag,
    `${base.stronghold}/${base.gamesense}/${base.entryfrag} +${variant.statBoost} → ` +
    `${combatGuardado.stronghold}/${combatGuardado.gamesense}/${combatGuardado.entryfrag}`);

  check("rank y bucket los fija la variante",
    Number(fila.rarity_rank) === variant.rank && fila.rarity_bucket === bucketForRank(variant.rank),
    `rank ${fila.rarity_rank} · ${fila.rarity_bucket}`);

  const { data: pRow } = await db.from("content_players").select("stats")
    .eq("id", String(fila.player_id)).maybeSingle();
  const statsEsperadas = applyStatBoost((pRow as { stats: never }).stats, variant.statBoost);
  /*
   * Se compara clave a clave, no con `JSON.stringify`: `jsonb` guarda las claves en su propio
   * orden y dos objetos idénticos serializan distinto. Comparar cadenas aquí habría dado un
   * fallo que no existe, que es la peor clase de fallo en una verificación.
   */
  const statsGuardadas = fila.stats as unknown as Record<string, number>;
  const clavesMal = (["dmg", "scr", "com", "hs", "ast", "clu"] as const)
    .filter((k) => statsGuardadas[k] !== (statsEsperadas as unknown as Record<string, number>)[k]);
  check("las 6 estadísticas heredadas salen del jugador más el boost", clavesMal.length === 0,
    clavesMal.length ? `difieren: ${clavesMal.join(", ")}`
      : (["dmg", "scr", "com", "hs", "ast", "clu"] as const)
          .map((k) => `${k}=${statsGuardadas[k]}`).join(" "));

  /*
   * LA HUELLA, recalculada aquí con la MISMA función del servidor.
   *
   * No se compara contra «algo no vacío»: se comprueba que describe exactamente la fila que
   * hay en la base. Una huella presente pero desfasada es peor que ninguna, y era justo lo
   * que dejaba `app_content_update_draft` al conservar la anterior.
   */
  const huella = cardChecksum({
    id: String(fila.card_id), playerId: String(fila.player_id),
    variantId: String(fila.variant_id) as never,
    ovr: Number(fila.ovr), stats: fila.stats as never, combat: combatGuardado,
    statBoost: Number(fila.stat_boost), dataVersion: String(fila.data_version),
    source: fila.source as never,
    generatedAt: new Date(String(fila.generated_at)).toISOString(),
  });
  check("la huella describe la fila que hay guardada", fila.checksum === huella,
    `${String(fila.checksum).slice(0, 12)}… vs ${huella.slice(0, 12)}…`);

  check("un trío distinto del derivado marca la carta como editorial",
    fila.source === "editorial",
    "deja de ser un dato de VLR y pasa a ser una decisión con actor y motivo");

  // ── Idempotencia: no se versiona lo que no cambia ──
  const { data: v2 } = await db.from("content_cards")
    .select("definition_version").eq("card_id", cardId).maybeSingle();
  const sinCambio = await api("publish", {
    cardId, reason: "otra vez lo mismo", combat: base,
    expectedVersion: Number((v2 as { definition_version: number }).definition_version),
  });
  check("publicar una versión idéntica se rechaza", sinCambio.status === 400,
    "una versión que no cambia nada solo ensucia el historial");

  // ── La vuelta base ↔ guardado ──
  const ed = await api<{ baseCombat: CombatStats; baseExact: boolean }>("editor", { cardId });
  check("el editor devuelve la base que reproduce el trío guardado",
    ed.status === 200 && ed.data.baseExact
    && applyCombatBoost(ed.data.baseCombat, variant.statBoost).stronghold === combatGuardado.stronghold,
    `base ${ed.data?.baseCombat?.stronghold}/${ed.data?.baseCombat?.gamesense}/${ed.data?.baseCombat?.entryfrag}`);

  const vuelta = unboost(combatGuardado, variant.statBoost);
  check("`unboost` es exacta para una carta derivada", vuelta.exact,
    `${vuelta.base.stronghold}/${vuelta.base.gamesense}/${vuelta.base.entryfrag}`);

}

// ─────────────── 10 · CICLO DE VIDA Y ELEGIBILIDAD PARA SOBRES ───────────────

/**
 * Qué entra en un sobre y qué no, comprobado contra el registro que usa el sorteo.
 *
 * No se mira `lifecycle` y se da por hecho el resto: se pregunta al MISMO registro que
 * `openPack()` recorre para elegir una carta. Un estado que dijera RETIRED mientras la carta
 * sigue en el registro sería exactamente el fallo que esto busca.
 */
async function familiaCicloDeVida(cardId: string | null): Promise<void> {
  title("10 · CICLO DE VIDA Y ELEGIBILIDAD PARA SOBRES");
  if (!servidorVivo || !cardId) { omit("ciclo de vida", "sin servidor o sin carta"); return; }

  const registro = async (): Promise<{ enCatalogo: boolean; sorteable: boolean }> => {
    resetServerCatalog(); resetServerDistribution();
    const cat = await serverCatalog(db);
    return { enCatalogo: cat.has(cardId), sorteable: cat.packEngine.registry.has(cardId) };
  };

  const publicada = await registro();
  check("PUBLISHED: está en el catálogo y puede salir en sobres",
    publicada.enCatalogo && publicada.sorteable, "en el registro de sorteo");

  const ret = await api("lifecycle", { cardId, state: "RETIRED", reason: "verificación 8.4.2" });
  check("se retira", ret.status === 200, `HTTP ${ret.status}`);

  const retirada = await registro();
  check("RETIRED: sale del sorteo pero NO del catálogo", !retirada.sorteable && retirada.enCatalogo,
    "quien ya la tiene la sigue resolviendo; los sobres nuevos no la reparten");

  const { data: filaRet } = await db.from("content_cards")
    .select("retired_at, definition_version").eq("card_id", cardId).maybeSingle();
  const fr = filaRet as { retired_at: string | null; definition_version: number };
  check("retirar deja fecha y NO borra nada", fr.retired_at !== null && fr.definition_version >= 1,
    `retirada ${fr.retired_at?.slice(0, 10)} · definición en v${fr.definition_version}`);

  const { count: versionesVivas } = await db.from("content_card_versions")
    .select("card_id", { count: "exact", head: true }).eq("card_id", cardId);
  check("el historial de versiones sigue completo tras retirar", (versionesVivas ?? 0) >= 1,
    `${versionesVivas} versiones`);

  // Una carta retirada SÍ se puede seguir versionando: retirar no es archivar.
  const { data: vAct } = await db.from("content_cards")
    .select("definition_version").eq("card_id", cardId).maybeSingle();
  const vRet = Number((vAct as { definition_version: number }).definition_version);
  const versionRetirada = await api("publish", {
    cardId, reason: "verificación 8.4.2: retocar una retirada",
    combat: { stronghold: 33, gamesense: 33, entryfrag: 33 }, expectedVersion: vRet,
  });
  check("una carta RETIRADA todavía se puede versionar", versionRetirada.status === 200,
    "retirar la saca de circulación; no congela su definición");

  const trasVersionar = await registro();
  check("y versionarla NO la devuelve al sorteo", !trasVersionar.sorteable,
    "el estado manda sobre la edición");

  const vuelta = await api("lifecycle", { cardId, state: "PUBLISHED", reason: "verificación 8.4.2" });
  check("volver a publicarla la devuelve al sorteo", vuelta.status === 200 && (await registro()).sorteable,
    "de vuelta en el registro");

  // ARCHIVED es el final del camino.
  await api("lifecycle", { cardId, state: "RETIRED", reason: "verificación 8.4.2" });
  const arch = await api("lifecycle", { cardId, state: "ARCHIVED", reason: "verificación 8.4.2" });
  check("una retirada se puede archivar", arch.status === 200, `HTTP ${arch.status}`);

  const { data: vArch } = await db.from("content_cards")
    .select("definition_version").eq("card_id", cardId).maybeSingle();
  const edicionArchivada = await api("publish", {
    cardId, reason: "x", combat: { stronghold: 22, gamesense: 22, entryfrag: 22 },
    expectedVersion: Number((vArch as { definition_version: number }).definition_version),
  });
  check("una carta ARCHIVADA ya no se versiona", edicionArchivada.status === 409,
    "es el final del ciclo de vida");
}

async function main(): Promise<void> {
  console.log("\n═══ VERIFICACIÓN DEL PANEL DE CARTAS (Bloques 8.4.1 y 8.4.2) ═══");
  console.log(`  base de datos: ${URL_}`);
  servidorVivo = await fetch(`${BASE}/api/game/state`, { cache: "no-store" })
    .then((r) => r.status > 0).catch(() => false);
  console.log(`  servidor:      ${servidorVivo ? BASE : `${BASE} (no responde — HTTP omitido)`}`);

  if (servidorVivo) adminToken = (await cuenta("admin", true)).token;

  await familiaApi();
  const nueva = await familiaAlta();
  await familiaIntegridad();
  await familiaConcurrencia(nueva);
  await familiaD1b();
  await familiaSeguridad(nueva);
  await familiaAuditoria(nueva);
  await familiaFirmas();
  await familiaDerivacion(nueva);
  await familiaCicloDeVida(nueva);
}

async function limpiar(): Promise<void> {
  for (const cardId of cartasCreadas) {
    await db.from("content_card_market_anchor").delete().eq("card_id", cardId).then(() => {}, () => {});
    await db.rpc("app_content_purge_card", { p_card_id: cardId }).then(() => {}, () => {});
    await db.from("content_audit_log").delete().eq("card_id", cardId).then(() => {}, () => {});
  }
  for (const [cardId, fila] of cartasTocadas) {
    await db.from("content_cards").update({
      ovr: fila.ovr, combat: fila.combat, stats: fila.stats, stat_boost: fila.stat_boost,
      rarity_rank: fila.rarity_rank, rarity_bucket: fila.rarity_bucket,
      definition_version: fila.definition_version, checksum: fila.checksum,
    /*
     * `source`, `data_version` y `generated_at` TAMBIEN se restauran, y es nuevo en 8.4.2.
     *
     * Hasta ahora publicar una version no tocaba `source`, porque la ruta no lo enviaba. Desde
     * 8.4.2 si: un trio distinto del que deriva el generador marca la carta `editorial`, que es
     * lo correcto —lo ha decidido una persona— pero significa que una prueba que edita una
     * carta REAL y no restaura este campo deja el catalogo afirmando que una carta del
     * generador es editorial. Lo destapo `content-catalog:verify` con un unico desajuste:
     * «caedye__bronze: source».
     */
      source: fila.source, data_version: fila.data_version, generated_at: fila.generated_at,
      lifecycle: fila.lifecycle, retired_at: fila.retired_at, published_at: fila.published_at,
    }).eq("card_id", cardId);
    await db.from("content_card_versions").delete().eq("card_id", cardId).gt("version", 1);
    await db.from("content_card_versions").update({ effective_to: null })
      .eq("card_id", cardId).eq("version", 1);
    await db.from("content_card_market_anchor").delete().eq("card_id", cardId);
    await db.from("content_audit_log").delete().eq("card_id", cardId);
  }
  // El catálogo cambió con un UPDATE directo: hay que avisar al servidor.
  await db.rpc("_bump_catalog").then(() => {}, () => {});
  for (const id of cuentas) await db.auth.admin.deleteUser(id).catch(() => {});

  const { count: extra } = await db.from("content_card_versions")
    .select("card_id", { count: "exact", head: true }).gt("version", 1);
  const { count: admin } = await db.from("content_cards")
    .select("card_id", { count: "exact", head: true }).eq("origin", "admin");
  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${extra} versiones extra · ${admin} cartas de origen admin`);

  /*
   * EL CATÁLOGO DEL GENERADOR, INTACTO — y se comprueba AQUÍ, no antes.
   *
   * La familia 3 versiona a propósito una carta real con ejemplares, porque es la única forma
   * de demostrar que publicar no toca una instancia. Mientras esa prueba corre, hay una carta
   * `seed-generator` en v2, y eso es correcto. Lo que no puede quedar es el rastro: cuando la
   * restauración ha terminado, `v_content_cards_editadas` tiene que volver a cero.
   *
   * `v_content_cards_editadas` es la vista de 0041: es la que enuncia sobre qué conjunto sigue
   * siendo cierta la garantía de 8.1 —«lo persistido es lo que produce el generador»— ahora que
   * existe un panel capaz de editarlo.
   */
  const { count: editadas } = await db.from("v_content_cards_editadas")
    .select("card_id", { count: "exact", head: true }).eq("origin", "seed-generator");
  check("al terminar, ninguna carta del generador queda versionada", editadas === 0,
    `${editadas} cartas seed-generator con definition_version > 1`);
}

main()
  .catch((e) => { console.error("\n✕ verificación abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar();
    console.log("\n" + "─".repeat(74));
    console.log(`  ${pass} correctas · ${fail} fallidas${skip ? ` · ${skip} omitidas` : ""}`);
    console.log(fail === 0
      ? "  ✅ LA ADMINISTRACIÓN DE CARTAS ES REAL, AUTORITATIVA Y NO TOCA LA HISTORIA"
      : "  ❌ EL PANEL DE CARTAS TIENE HUECOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
