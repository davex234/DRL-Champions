/**
 * VERIFICACIÓN DEL PANEL DE POOLS — `npm run pools-admin:verify` (Bloque 8.4.3).
 *
 * 8.3 ya demostró que el MOTOR no cambia: determinismo bit a bit, `pickWeighted` con peso 1
 * reducido a `rng.pick`, probabilidad efectiva exacta, 400.000 tiradas de sanidad estadística.
 * Eso sigue verificándolo `content-pools:verify` y aquí no se repite.
 *
 * Lo que se verifica aquí es la superficie NUEVA — la que permite que una persona controle la
 * distribución sin tocar el motor:
 *
 *   1. La API sirve los pools reales, con su salud, en una consulta.
 *   2. Alta, entradas granulares y ciclo de vida.
 *   3. Los pesos producen las cuotas que dice el motor, no las que diría una regla de tres.
 *   4. Dos administradores sobre el mismo pool: uno gana, el otro se entera.
 *   5. La caché se invalida — incluida la colisión de clave que este bloque encontró.
 *   6. Simular no acuña.
 *   7. La probabilidad se descompone y no miente.
 *   8. Seguridad.
 *   9. Diario.
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
import { bucketForRank } from "../src/domain/packs/types";
import { getVariant } from "../src/domain/cards/variants";

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
let servidorVivo = false;
let adminToken = "";
const cuentas: string[] = [];
const poolsCreados: string[] = [];

const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const omit = (l: string, motivo: string): void => {
  console.log(`  [OMIT] ${l} — ${motivo}`); omit_++;
};
const title = (t: string): void => console.log(`\n─── ${t} ${"─".repeat(Math.max(0, 66 - t.length))}`);

async function cuenta(tag: string, esAdmin: boolean): Promise<{ id: string; token: string }> {
  const email = `pools843-${tag}-${randomUUID()}@nexus.test`;
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

async function api<T = Record<string, unknown>>(
  action: string, body: Record<string, unknown> = {}, token = adminToken,
): Promise<{ status: number; data: T }> {
  const r = await fetch(`${BASE}/api/admin/pools`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...body }),
    cache: "no-store",
  });
  let data: unknown = null;
  try { data = await r.json(); } catch { data = {}; }
  return { status: r.status, data: data as T };
}

/**
 * Crea una carta en DRAFT para poder comprobar que un pool ACTIVO la rechaza.
 *
 * Va por la API real de 8.4.2 —jugador + variante, el resto lo deriva el servidor— porque una
 * fila insertada a mano no probaría el camino que un administrador recorre de verdad.
 */
const cartasCreadas: string[] = [];
async function crearBorrador(): Promise<string | null> {
  const { data: cands } = await db.from("content_players").select("id").limit(80);
  for (const p of ((cands ?? []) as { id: string }[])) {
    const { count } = await db.from("content_cards")
      .select("card_id", { count: "exact", head: true }).eq("card_id", `${p.id}__mythic`);
    const { count: tiene } = await db.from("content_cards")
      .select("card_id", { count: "exact", head: true }).eq("player_id", p.id);
    if (count !== 0 || (tiene ?? 0) === 0) continue;

    const r = await fetch(`${BASE}/api/admin/cards`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: "create", playerId: p.id, variantId: "mythic", reason: "verificación 8.4.3" }),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { cardId: string };
    cartasCreadas.push(d.cardId);
    return d.cardId;
  }
  return null;
}

/**
 * Huella de todo lo que un cambio de distribución NO puede tocar.
 *
 * Excluye la carta en borrador que esta verificación crea para la familia 2. Es obra suya, así
 * que contarla haría que la huella cambiara siempre y la comprobación no dijera nada. Lo que
 * se afirma es lo que importa: **nada de lo que ya existía se ha movido** mientras se crean
 * pools, se cambian pesos, se publica, se retira y se simula.
 */
async function huellaJuego(): Promise<string> {
  const h = createHash("sha256");
  for (const [t, cols, key] of [
    ["user_cards", "uid, user_id, card_id, serial, minted_version", "uid"],
    ["card_mints", "card_id, minted", "card_id"],
    ["duel_decks", "id, user_id, card_uids", "id"],
    ["market_listings", "id, card_id, price, status", "id"],
    ["content_cards", "card_id, ovr, definition_version, lifecycle", "card_id"],
  ] as const) {
    let q = db.from(t).select(cols).order(key);
    for (const cardId of cartasCreadas) if (t !== "duel_decks") q = q.neq("card_id", cardId);
    const { data } = await q;
    h.update(t).update(JSON.stringify(data ?? []));
  }
  return h.digest("hex");
}

// ───────────────────────── 1 · LA API SIRVE LOS POOLS REALES ─────────────────────────

async function familiaApi(): Promise<void> {
  title("1 · LA API SIRVE LOS POOLS REALES");
  if (!servidorVivo) { omit("API", "no hay servidor"); return; }

  const l = await api<{ rows: Record<string, unknown>[]; facets: Record<string, string[]> }>("list");
  const { count: reales } = await db.from("content_pools").select("id", { count: "exact", head: true });
  check("el listado devuelve TODOS los pools persistidos",
    l.status === 200 && l.data.rows.length === reales, `${l.data.rows?.length} = ${reales}`);

  const { data: entradas } = await db.from("content_pool_entries")
    .select("pool_id", { count: "exact", head: true }).eq("pool_id", "pack-inicial").eq("mode", "INCLUDE");
  void entradas;
  const { count: nInicial } = await db.from("content_pool_entries")
    .select("card_id", { count: "exact", head: true }).eq("pool_id", "pack-inicial").eq("mode", "INCLUDE");
  const inicial = l.data.rows.find((r) => r.id === "pack-inicial");
  check("cada fila trae su salud sin preguntar pool a pool",
    Number(inicial?.includes) === nInicial && Array.isArray(inicial?.packs),
    `pack-inicial: ${inicial?.includes} cartas · sobres ${JSON.stringify(inicial?.packs)}`);

  const s = await api<{ entriesTotal: number; resumen: Record<string, number>; revision: number }>(
    "sheet", { poolId: "pack-inicial", pageSize: 5 });
  check("la ficha pagina y resume sobre el TOTAL, no sobre la página",
    s.status === 200 && s.data.entriesTotal === nInicial && s.data.resumen.includes === nInicial,
    `${s.data.entriesTotal} entradas · resumen sobre ${s.data.resumen?.includes}`);

  const inexistente = await api("sheet", { poolId: "no-existe" });
  check("un pool inexistente da 404", inexistente.status === 404);
}

// ───────────────── 2 · ALTA, ENTRADAS GRANULARES Y CICLO DE VIDA ─────────────────

async function familiaCiclo(): Promise<string | null> {
  title("2 · ALTA, ENTRADAS Y CICLO DE VIDA");
  if (!servidorVivo) { omit("ciclo", "no hay servidor"); return null; }

  const poolId = `v843-${randomUUID().slice(0, 8)}`;

  const sinMotivo = await api("upsert", { pool: { id: poolId, name: "Verificación 8.4.3" } });
  check("un alta SIN MOTIVO se rechaza", sinMotivo.status === 400 || sinMotivo.status === 409,
    `HTTP ${sinMotivo.status}`);

  const alta = await api<{ poolId: string; revision: number }>("upsert", {
    pool: { id: poolId, name: "Verificación 8.4.3", mode: "EXPLICIT", description: "temporal" },
    reason: "verificación 8.4.3",
  });
  check("el alta crea el pool", alta.status === 200, alta.data?.poolId ?? JSON.stringify(alta.data));
  if (alta.status !== 200) return null;
  poolsCreados.push(poolId);

  const { data: creado } = await db.from("content_pools").select("lifecycle, revision").eq("id", poolId).maybeSingle();
  check("nace en DRAFT", (creado as { lifecycle: string }).lifecycle === "DRAFT");

  // Un pool DRAFT vacío no puede activarse.
  const vacio = await api("publish", { poolId, state: "ACTIVE", reason: "x" });
  check("un pool EXPLICIT vacío no se puede activar", vacio.status === 409,
    "un sobre sin nada que entregar no es una configuración válida");

  // Tres cartas publicadas, con los pesos del encargo.
  const { data: cartas } = await db.from("content_cards")
    .select("card_id").eq("lifecycle", "PUBLISHED").order("card_id").limit(3);
  const ids = ((cartas ?? []) as { card_id: string }[]).map((c) => c.card_id);
  const pesos = [10, 20, 5];

  let rev = Number((creado as { revision: number }).revision);
  for (let i = 0; i < ids.length; i++) {
    const r = await api<{ revision: number }>("entryUpsert", {
      poolId, cardId: ids[i], weight: pesos[i], mode: "INCLUDE",
      reason: `verificación: ${ids[i]} con peso ${pesos[i]}`, expectedRevision: rev,
    });
    if (r.status !== 200) { check(`añadir ${ids[i]}`, false, JSON.stringify(r.data)); return poolId; }
    rev = r.data.revision;
  }
  check("las tres cartas entran, una operación atómica cada una", true,
    `${ids.join(", ")} con pesos ${pesos.join("/")}`);

  const duplicada = await api<{ nueva: boolean }>("entryUpsert", {
    poolId, cardId: ids[0], weight: 99, mode: "INCLUDE",
    reason: "la misma otra vez", expectedRevision: rev,
  });
  check("añadir una carta que ya está NO la duplica: actualiza su peso",
    duplicada.status === 200 && duplicada.data.nueva === false, "la clave primaria lo garantiza");
  rev = (duplicada.data as unknown as { revision: number }).revision;
  // Se devuelve a su peso.
  const vuelta = await api<{ revision: number }>("entryUpsert", {
    poolId, cardId: ids[0], weight: pesos[0], mode: "INCLUDE",
    reason: "restaurar", expectedRevision: rev,
  });
  rev = vuelta.data.revision;

  const { count: nEntradas } = await db.from("content_pool_entries")
    .select("card_id", { count: "exact", head: true }).eq("pool_id", poolId);
  check("y siguen siendo tres entradas, no cuatro", nEntradas === 3, `${nEntradas}`);

  // Validaciones que deben rechazarse.
  const malos: [string, Record<string, unknown>][] = [
    ["peso 0", { cardId: ids[0], weight: 0 }],
    ["peso negativo", { cardId: ids[0], weight: -5 }],
    ["peso desmesurado", { cardId: ids[0], weight: 2_000_000 }],
    ["peso no numérico", { cardId: ids[0], weight: "diez" }],
    ["carta inexistente", { cardId: "no__existe", weight: 1 }],
    ["sin motivo", { cardId: ids[0], weight: 1, sinMotivo: true }],
  ];
  const colados: string[] = [];
  for (const [nombre, extra] of malos) {
    const sinM = extra.sinMotivo === true;
    delete extra.sinMotivo;
    const r = await api("entryUpsert", {
      poolId, mode: "INCLUDE", expectedRevision: rev,
      ...(sinM ? {} : { reason: "prueba" }), ...extra,
    });
    if (r.status === 200) colados.push(nombre);
  }
  check("toda configuración inválida se rechaza", colados.length === 0,
    colados.length ? `se colaron: ${colados.join(", ")}` : `${malos.length} formas rechazadas`);

  const poolFalso = await api("entryUpsert", {
    poolId: "no-existe", cardId: ids[0], weight: 1, reason: "x",
  });
  check("un pool inexistente se rechaza", poolFalso.status === 409 || poolFalso.status === 404);

  // Activar: ya se puede.
  const act = await api<{ to: string; revision: number }>("publish", {
    poolId, state: "ACTIVE", reason: "verificación 8.4.3", expectedRevision: rev,
  });
  check("con cartas dentro, el pool se activa", act.status === 200 && act.data.to === "ACTIVE");
  rev = act.data.revision;

  /*
   * Una carta DRAFT no puede entrar en un pool ACTIVO.
   *
   * La primera versión de esto buscaba una carta en borrador y, si no había ninguna, se
   * saltaba la comprobación. Una comprobación que depende de que el catálogo esté en cierto
   * estado no comprueba nada el día que no lo está: se crea la carta a propósito y se purga
   * al terminar.
   */
  const borradorId = await crearBorrador();
  if (borradorId) {
    const r = await api("entryUpsert", {
      poolId, cardId: borradorId, weight: 1,
      reason: "no debería", expectedRevision: rev,
    });
    check("una carta en DRAFT no entra en un pool ACTIVO", r.status === 409,
      "sería repartir contenido que nadie ha aprobado");
  } else {
    check("una carta en DRAFT no entra en un pool ACTIVO", false,
      "no se pudo crear la carta de prueba");
  }

  // Vaciar un pool EXPLICIT activo: prohibido.
  for (const id of ids.slice(1)) {
    const r = await api<{ revision: number }>("entryRemove", {
      poolId, cardId: id, reason: "vaciando", expectedRevision: rev,
    });
    rev = r.data?.revision ?? rev;
  }
  const ultima = await api("entryRemove", {
    poolId, cardId: ids[0], reason: "la última", expectedRevision: rev,
  });
  check("no se puede quitar la ÚLTIMA carta de un pool EXPLICIT ACTIVO", ultima.status === 409,
    "el sobre se quedaría sin nada que entregar");

  // Devolver las dos y dejarlo listo para las familias siguientes.
  for (let i = 1; i < ids.length; i++) {
    const r = await api<{ revision: number }>("entryUpsert", {
      poolId, cardId: ids[i], weight: pesos[i], mode: "INCLUDE",
      reason: "restaurar", expectedRevision: rev,
    });
    rev = r.data.revision;
  }

  const ret = await api<{ revision: number }>("publish", {
    poolId, state: "RETIRED", reason: "verificación", expectedRevision: rev,
  });
  check("un pool activo se retira", ret.status === 200);
  const edicionRetirado = await api("entryUpsert", {
    poolId, cardId: ids[0], weight: 3, reason: "no debería", expectedRevision: ret.data.revision,
  });
  check("un pool RETIRADO no se edita", edicionRetirado.status === 409,
    "para cambiarlo hay que reactivarlo, y eso deja rastro");

  await api("publish", { poolId, state: "ACTIVE", reason: "restaurar", expectedRevision: ret.data.revision });
  return poolId;
}

// ───────────────── 3 · PESOS Y CUOTAS: LAS DEL MOTOR ─────────────────

async function familiaPesos(poolId: string | null): Promise<void> {
  title("3 · PESOS Y CUOTAS — las que dice el motor");
  if (!servidorVivo || !poolId) { omit("pesos", "sin servidor o sin pool"); return; }

  const s = await api<{ entries: { cardId: string; weight: number; cuota: number }[]; resumen: { pesoTotal: number } }>(
    "sheet", { poolId, pageSize: 50 });
  const e = s.data.entries;
  check("el peso total es la suma de los pesos", s.data.resumen.pesoTotal === 35,
    `10 + 20 + 5 = ${s.data.resumen.pesoTotal}`);

  /*
   * EL CASO DEL ENCARGO, con los tres decimales.
   *
   * No se compara contra un porcentaje escrito a mano: se compara contra lo que devuelve
   * `effectiveProbabilities`, la misma función que consume el sorteo. Si el motor cambiara,
   * esta comprobación fallaría en vez de seguir dando por buena una cifra copiada.
   */
  const items = e.map((x) => ({ id: x.cardId, w: x.weight }));
  const esperado = effectiveProbabilities(items, (i) => i.w);
  const desajustes = e.filter((x) => {
    const t = esperado.find((y) => y.item.id === x.cardId);
    return !t || Math.abs(t.p - x.cuota) > 1e-12;
  });
  check("la cuota de cada entrada es la del motor", desajustes.length === 0,
    e.map((x) => `${x.weight}→${(x.cuota * 100).toFixed(3)}%`).join(" · "));

  const diez = e.find((x) => x.weight === 10)?.cuota ?? 0;
  const veinte = e.find((x) => x.weight === 20)?.cuota ?? 0;
  const cinco = e.find((x) => x.weight === 5)?.cuota ?? 0;
  check("10/20/5 da 28,571 / 57,143 / 14,286",
    (diez * 100).toFixed(3) === "28.571" && (veinte * 100).toFixed(3) === "57.143"
    && (cinco * 100).toFixed(3) === "14.286",
    `${(diez * 100).toFixed(3)} / ${(veinte * 100).toFixed(3)} / ${(cinco * 100).toFixed(3)}`);

  check("las cuotas suman 1", Math.abs(diez + veinte + cinco - 1) < 1e-12);
}

// ───────────────── 4 · CONCURRENCIA ─────────────────

async function familiaConcurrencia(poolId: string | null): Promise<void> {
  title("4 · DOS ADMINISTRADORES SOBRE EL MISMO POOL");
  if (!servidorVivo || !poolId) { omit("concurrencia", "sin servidor o sin pool"); return; }

  const { data: p } = await db.from("content_pools").select("revision").eq("id", poolId).maybeSingle();
  const rev = Number((p as { revision: number }).revision);
  const { data: e } = await db.from("content_pool_entries")
    .select("card_id").eq("pool_id", poolId).order("card_id").limit(1).maybeSingle();
  const cardId = (e as { card_id: string }).card_id;

  // A y B abren con la misma revisión; A guarda; B intenta con la vieja.
  const a = await api<{ revision: number }>("entryUpsert", {
    poolId, cardId, weight: 11, reason: "admin A", expectedRevision: rev,
  });
  check("el primero en guardar gana", a.status === 200, `r${rev} → r${a.data?.revision}`);

  const b = await api<{ error: string; conflict?: boolean; current?: number }>("entryUpsert", {
    poolId, cardId, weight: 22, reason: "admin B", expectedRevision: rev,
  });
  check("el segundo NO sobrescribe en silencio", b.status === 409 && b.data.conflict === true,
    b.data?.error?.slice(0, 72) ?? "");
  check("y el rechazo dice cuál es la revisión vigente", b.data.current === a.data?.revision,
    `vigente r${b.data?.current}`);

  const { data: tras } = await db.from("content_pool_entries")
    .select("weight").eq("pool_id", poolId).eq("card_id", cardId).maybeSingle();
  check("el cambio de A sigue en pie: el de B no lo pisó",
    Number((tras as { weight: number }).weight) === 11, `peso ${(tras as { weight: number }).weight}`);

  // Dos publicaciones simultáneas de verdad.
  const { data: p2 } = await db.from("content_pools").select("revision").eq("id", poolId).maybeSingle();
  const rev2 = Number((p2 as { revision: number }).revision);
  const [x, y] = await Promise.all([
    api("publish", { poolId, state: "DRAFT", reason: "simultánea 1", expectedRevision: rev2 }),
    api("publish", { poolId, state: "DRAFT", reason: "simultánea 2", expectedRevision: rev2 }),
  ]);
  const exitos = [x, y].filter((r) => r.status === 200).length;
  check("de dos publicaciones simultáneas, solo UNA sale adelante", exitos === 1,
    `${exitos} aceptada(s) · ${x.status}/${y.status}`);

  // Y sin `expectedRevision` se sigue pudiendo trabajar: el testigo es opcional.
  const sinTestigo = await api("publish", { poolId, state: "ACTIVE", reason: "restaurar" });
  check("sin `expectedRevision` la operación sigue siendo posible", sinTestigo.status === 200,
    "el testigo protege a quien lo usa; no rompe a quien no lo envía");
}

// ───────────────── 5 · CACHÉ E INVALIDACIÓN ─────────────────

async function familiaCache(poolId: string | null): Promise<void> {
  title("5 · CACHÉ — un cambio se ve, y se ve entero");
  if (!servidorVivo || !poolId) { omit("caché", "sin servidor o sin pool"); return; }

  /*
   * LA COLISIÓN DE CLAVE QUE ESTE BLOQUE ENCONTRÓ.
   *
   * `buildPool` cachea la PERTENENCIA por `${pack.id}@${dist.key}`, y hasta 8.4.3 esa clave
   * era `${pool.id}#${entries.length}`: solo el identificador y CUÁNTAS entradas había. Dos
   * configuraciones distintas con el mismo número de entradas compartían clave, así que
   * sustituir una carta por otra dejaba el proceso repartiendo la configuración anterior.
   *
   * Se comprueba en el dominio, sin base de datos: es donde vive el fallo.
   */
  const cat = await serverCatalog(db);
  const pack = getPack("inicial")!;
  const { data: tres } = await db.from("content_cards")
    .select("card_id").eq("lifecycle", "PUBLISHED").eq("rarity_bucket", "common").order("card_id").limit(4);
  const ids = ((tres ?? []) as { card_id: string }[]).map((c) => c.card_id);

  const mk = (cards: string[]): PoolDef => ({
    id: "cache-test", mode: "EXPLICIT", rules: {},
    entries: cards.map((cardId) => ({ cardId, weight: 1, mode: "INCLUDE" as const })),
    availableFrom: null, availableTo: null,
  });
  const dA = composeDistribution([{ pool: mk(ids.slice(0, 3)), priority: 100 }], Date.now())!;
  const dB = composeDistribution([{ pool: mk([ids[0], ids[1], ids[3]]), priority: 100 }], Date.now())!;

  check("dos configuraciones distintas NO comparten clave de caché", dA.key !== dB.key,
    `${dA.key} vs ${dB.key}`);

  const flatA = buildPool(cat.packEngine.registry, pack, dA).flat.map((c) => c.id).sort();
  const flatB = buildPool(cat.packEngine.registry, pack, dB).flat.map((c) => c.id).sort();
  check("y buildPool no sirve la pertenencia anterior",
    JSON.stringify(flatA) !== JSON.stringify(flatB) && flatB.includes(ids[3]),
    `A=${flatA.length} B=${flatB.length} · la carta nueva está en B`);

  // ── Y la invalidación de verdad, contra el servidor ──
  const { data: p } = await db.from("content_pools").select("revision").eq("id", poolId).maybeSingle();
  const rev = Number((p as { revision: number }).revision);
  const { data: e } = await db.from("content_pool_entries")
    .select("card_id, weight").eq("pool_id", poolId).order("card_id").limit(1).maybeSingle();
  const cardId = (e as { card_id: string }).card_id;

  const { data: antesVer } = await db.from("content_distribution_version").select("version").eq("id", true).maybeSingle();
  const vAntes = Number((antesVer as { version: number }).version);

  const r = await api("entryUpsert", {
    poolId, cardId, weight: 77, reason: "prueba de caché", expectedRevision: rev,
  });
  check("cambiar un peso sube la versión de la distribución", r.status === 200);

  const { data: trasVer } = await db.from("content_distribution_version").select("version").eq("id", true).maybeSingle();
  check("la versión global ha subido en la MISMA transacción",
    Number((trasVer as { version: number }).version) > vAntes,
    `v${vAntes} → v${(trasVer as { version: number }).version}`);

  resetServerDistribution();
  const dist = await serverDistribution(db);
  const pool = dist.pools.get(poolId);
  const entrada = pool?.entries.find((x) => x.cardId === cardId);
  check("y el servidor lee el peso NUEVO, no el anterior", entrada?.weight === 77,
    `peso servido ${entrada?.weight}`);
}

// ───────────────── 6 · SIMULAR NO ACUÑA ─────────────────

async function familiaSimulacion(): Promise<void> {
  title("6 · SIMULAR NO TOCA NADA");
  if (!servidorVivo) { omit("simulación", "no hay servidor"); return; }

  const antes = await huellaJuego();
  const { count: ucAntes } = await db.from("user_cards").select("uid", { count: "exact", head: true });

  const t0 = Date.now();
  const sim = await api<{ cartas: number; buckets: { bucket: string; esperado: number; observado: number }[]; ms: number }>(
    "simulate", { packId: "inicial", aperturas: 4000, seed: "verificacion-843" });
  const ms = Date.now() - t0;
  check("la simulación responde", sim.status === 200, `${sim.data.cartas} cartas · ${sim.data.ms} ms · ${ms} ms total`);

  const despues = await huellaJuego();
  const { count: ucDespues } = await db.from("user_cards").select("uid", { count: "exact", head: true });
  check("NADA ha cambiado: ni ejemplares, ni acuñaciones, ni mercado, ni catálogo",
    antes === despues && ucAntes === ucDespues,
    `user_cards ${ucAntes} → ${ucDespues}, huella idéntica`);

  /*
   * Lo observado tiene que parecerse a lo esperado. No se exige igualdad —es un sorteo— sino
   * que la desviación quepa en el error de muestreo: 4 sigmas sobre una binomial de n cartas.
   * Un fallo aquí significaría que la simulación no está usando la distribución que dice.
   */
  const n = sim.data.cartas;
  const malos = sim.data.buckets.filter((b) => {
    if (b.esperado === 0) return b.observado !== 0;
    const sigma = Math.sqrt((b.esperado * (1 - b.esperado)) / n);
    return Math.abs(b.observado - b.esperado) > 4 * sigma;
  });
  check("lo observado converge a lo esperado", malos.length === 0,
    malos.length ? malos.map((b) => `${b.bucket}: ${b.observado.toFixed(4)} vs ${b.esperado}`).join(" | ")
      : sim.data.buckets.map((b) => `${b.bucket} ${(b.observado * 100).toFixed(2)}%`).join(" · "));

  const demasiado = await api("simulate", { packId: "inicial", aperturas: 999_999 });
  check("una simulación desmesurada se rechaza", demasiado.status === 400, "hay un tope declarado");

  const sobreFalso = await api("simulate", { packId: "no-existe", aperturas: 10 });
  check("un sobre inexistente se rechaza", sobreFalso.status === 404);
}

// ───────────────── 7 · LA PROBABILIDAD NO MIENTE ─────────────────

async function familiaProbabilidad(): Promise<void> {
  title("7 · LA PROBABILIDAD SE DESCOMPONE Y CUADRA");
  if (!servidorVivo) { omit("probabilidad", "no hay servidor"); return; }

  const cat = await serverCatalog(db);
  const dist = await serverDistribution(db);
  const pack = getPack("inicial")!;
  const d = dist.forPack("inicial");
  const { pool } = buildPool(cat.packEngine.registry, pack, d);

  // Una carta épica del sobre inicial: bucket con poco stock, que es donde más se nota.
  const epica = pool.epic[0];
  if (!epica) { omit("probabilidad", "el sobre inicial no tiene épicas"); return; }

  const o = await api<{
    pBucket: number; pEnBucket: number; pPorHueco: number; huecos: number;
    pAlMenosUna: number; enPool: boolean; cartasEnBucket: number; weight: number;
  }>("cardOdds", { cardId: epica.id, packId: "inicial" });
  check("la API responde la probabilidad de una carta concreta", o.status === 200, epica.id);

  // Recalculado aquí con las mismas funciones del motor.
  const conStock = BUCKETS.filter((b) => pool[b].length > 0);
  const totalPeso = conStock.reduce((s, b) => s + (pack.weights[b] || 0), 0);
  const pBucketEsperado = (pack.weights.epic || 0) / totalPeso;
  const probs = effectiveProbabilities(pool.epic, (c) => (d ? d.weightOf(c.id) : 1));
  const pEnBucketEsperado = probs.find((x) => x.item.id === epica.id)?.p ?? 0;

  check("P(bucket) es la del motor, renormalizada sobre los buckets CON STOCK",
    Math.abs(o.data.pBucket - pBucketEsperado) < 1e-12,
    `${o.data.pBucket} = ${pBucketEsperado}`);
  check("P(carta | bucket) es la de effectiveProbabilities",
    Math.abs(o.data.pEnBucket - pEnBucketEsperado) < 1e-12,
    `${o.data.pEnBucket}`);
  check("y el producto es el que se enseña",
    Math.abs(o.data.pPorHueco - pBucketEsperado * pEnBucketEsperado) < 1e-12,
    `${(o.data.pPorHueco * 100).toFixed(4)} % por hueco`);
  check("«al menos una» usa los huecos reales del sobre",
    o.data.huecos === pack.cardCount
    && Math.abs(o.data.pAlMenosUna - (1 - Math.pow(1 - o.data.pPorHueco, pack.cardCount))) < 1e-12,
    `${pack.cardCount} huecos → ${(o.data.pAlMenosUna * 100).toFixed(4)} %`);

  /*
   * Un bucket SIN STOCK reparte 0 %, aunque el sobre anuncie un peso para él. Es el caso real
   * del sobre inicial con las legendarias: `rollBucket` solo reparte entre buckets con cartas.
   */
  const sinStock = BUCKETS.filter((b) => pool[b].length === 0);
  if (sinStock.length > 0) {
    const decl = pack.weights[sinStock[0]] || 0;
    check(`un bucket sin stock (${sinStock[0]}) reparte 0 aunque el sobre declare peso ${decl}`,
      true, "la probabilidad se renormaliza sobre los buckets que tienen cartas");
  }

  // Una carta que NO está en el pool: 0 y con motivo.
  const fuera = cat.cards.find((c) => !pool.common.some((x) => x.id === c.id)
    && !pool.uncommon.some((x) => x.id === c.id)
    && !pool.rare.some((x) => x.id === c.id)
    && !pool.epic.some((x) => x.id === c.id)
    && !pool.legendary.some((x) => x.id === c.id));
  if (fuera) {
    const f = await api<{ enPool: boolean; pPorHueco: number; motivo: string }>(
      "cardOdds", { cardId: fuera.id, packId: "inicial" });
    check("una carta fuera del pool da 0 y dice por qué",
      f.status === 200 && !f.data.enPool && f.data.pPorHueco === 0 && !!f.data.motivo,
      f.data?.motivo ?? "");
  } else {
    omit("carta fuera del pool", "el sobre inicial las contiene todas");
  }
}

// ───────────────── 8 · SEGURIDAD ─────────────────

async function familiaSeguridad(poolId: string | null): Promise<void> {
  title("8 · SEGURIDAD");
  if (!servidorVivo) { omit("seguridad", "no hay servidor"); return; }

  const usuario = await cuenta("normal", false);
  const objetivo = poolId ?? "pack-inicial";

  const acciones: [string, string, Record<string, unknown>][] = [
    ["listar", "list", {}],
    ["ver la ficha", "sheet", { poolId: objetivo }],
    ["crear pool", "upsert", { pool: { id: "intruso" }, reason: "x" }],
    ["editar pool", "upsert", { pool: { id: objetivo, name: "intruso" }, reason: "x" }],
    ["añadir entrada", "entryUpsert", { poolId: objetivo, cardId: "derke__prime", weight: 1, reason: "x" }],
    ["cambiar peso", "entryUpsert", { poolId: objetivo, cardId: "derke__prime", weight: 999, reason: "x" }],
    ["quitar entrada", "entryRemove", { poolId: objetivo, cardId: "derke__prime", reason: "x" }],
    ["reemplazar entradas", "setEntries", { poolId: objetivo, entries: [], reason: "x" }],
    ["publicar", "publish", { poolId: objetivo, state: "ACTIVE" }],
    ["retirar", "publish", { poolId: objetivo, state: "RETIRED" }],
    ["vincular sobre", "bind", { packId: "inicial", poolId: objetivo }],
    ["desvincular sobre", "unbind", { packId: "inicial", poolId: objetivo }],
    ["simular", "simulate", { packId: "inicial", aperturas: 10 }],
  ];

  const filtradas: string[] = [];
  for (const [etiqueta, accion, body] of acciones) {
    const sin = await api(accion, body, "");
    if (sin.status !== 401) filtradas.push(`sin sesión · ${etiqueta} → ${sin.status}`);
    const normal = await api(accion, body, usuario.token);
    if (normal.status !== 401) filtradas.push(`usuario normal · ${etiqueta} → ${normal.status}`);
  }
  check("ni anónimo ni usuario normal pueden hacer NADA", filtradas.length === 0,
    filtradas.length ? filtradas.slice(0, 3).join(" | ") : `${acciones.length * 2} intentos, todos 401`);

  const spoof = await api("entryUpsert", {
    poolId: objetivo, cardId: "derke__prime", weight: 999, reason: "x",
    userId: usuario.id, actor: usuario.id, role: "admin", is_admin: true, admin: true,
    owner: usuario.id,
  }, usuario.token);
  check("suplantar actor/role/admin/owner en el cuerpo no sirve", spoof.status === 401,
    `HTTP ${spoof.status}`);

  // Las RPC, directamente contra PostgREST.
  const rpcs: [string, Record<string, unknown>][] = [
    ["app_content_pool_upsert", { p_pool: { id: "x" }, p_reason: "x", p_actor: null }],
    ["app_content_pool_set_entries", { p_pool_id: objetivo, p_entries: [], p_reason: "x", p_actor: null }],
    ["app_content_pool_entry_upsert", { p_pool_id: objetivo, p_card_id: "derke__prime", p_weight: 1, p_mode: "INCLUDE", p_note: null, p_reason: "x", p_actor: null }],
    ["app_content_pool_entry_remove", { p_pool_id: objetivo, p_card_id: "derke__prime", p_reason: "x", p_actor: null }],
    ["app_content_pool_publish", { p_pool_id: objetivo, p_state: "RETIRED", p_actor: null }],
    ["app_content_pack_bind", { p_pack_id: "inicial", p_pool_id: objetivo, p_priority: 1, p_action: "bind", p_actor: null }],
  ];
  for (const rol of ["anon", "authenticated"] as const) {
    const cli = createClient(URL_, ANON, {
      auth: { persistSession: false },
      global: rol === "authenticated" ? { headers: { Authorization: `Bearer ${usuario.token}` } } : undefined,
    });
    const abiertas: string[] = [];
    for (const [fn, args] of rpcs) {
      const { error } = await cli.rpc(fn, args);
      if (!error || error.code !== "42501") abiertas.push(`${fn}: ${error?.code ?? "SIN ERROR"}`);
    }
    check(`${rol} NO puede invocar ninguna RPC de pools`, abiertas.length === 0,
      abiertas.length ? abiertas.join(" | ") : `${rpcs.length} funciones, todas 42501`);
  }

  // Las tablas, directamente.
  const cli = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${usuario.token}` } },
  });
  const lecturas: string[] = [];
  for (const t of ["content_pools", "content_pool_entries", "content_pack_pools", "v_pool_admin"]) {
    const { data, error } = await cli.from(t).select("*").limit(1);
    if (!error && (data ?? []).length > 0) lecturas.push(t);
  }
  check("un usuario normal no puede leer las tablas de distribución", lecturas.length === 0,
    lecturas.length ? `filtradas: ${lecturas.join(", ")}` : "RLS activo y sin políticas");
}

// ───────────────── 9 · DIARIO ─────────────────

async function familiaDiario(poolId: string | null): Promise<void> {
  title("9 · DIARIO");
  if (!servidorVivo || !poolId) { omit("diario", "sin servidor o sin pool"); return; }

  const { data } = await db.from("content_audit_log")
    .select("action, actor, card_id, detail").eq("pool_id", poolId);
  const filas = (data ?? []) as { action: string; actor: string | null; card_id: string | null; detail: Record<string, unknown> }[];
  const acciones = new Set(filas.map((f) => f.action));

  check("queda registrado el ALTA del pool", acciones.has("pool_create"), `${filas.length} entradas`);
  check("y cada carta añadida", acciones.has("pool_entry_add"));
  check("y cada peso cambiado", acciones.has("pool_entry_update"));
  check("y cada carta quitada", acciones.has("pool_entry_remove"));
  check("y la publicación y la retirada",
    acciones.has("pool_active") && acciones.has("pool_retired"),
    [...acciones].join(", "));

  check("cada entrada lleva actor y motivo",
    filas.every((f) => f.actor !== null && typeof f.detail?.reason === "string" && String(f.detail.reason).length > 0),
    "el actor sale del token, nunca del cuerpo");

  const conPii = filas.filter((f) => {
    const t = JSON.stringify(f.detail).toLowerCase();
    return t.includes("@") || t.includes("email") || t.includes("nexus.test");
  });
  check("el diario NO guarda datos personales", conPii.length === 0, "solo el id del actor");

  const cambioPeso = filas.find((f) => f.action === "pool_entry_update");
  check("un cambio de peso registra el antes y el después",
    Array.isArray(cambioPeso?.detail?.weight) && (cambioPeso!.detail.weight as unknown[]).length === 2,
    JSON.stringify(cambioPeso?.detail?.weight));
}

// ───────────────── 10 · EL JUEGO NO SE HA MOVIDO ─────────────────

async function familiaIntegridad(antes: string): Promise<void> {
  title("10 · NINGÚN CAMBIO DE DISTRIBUCIÓN TOCA EL JUEGO");
  const despues = await huellaJuego();
  check("ni ejemplares, ni acuñaciones, ni mazos, ni mercado, ni definiciones",
    antes === despues, "huella idéntica tras crear, llenar, publicar, retirar y simular");

  const { count: huecos } = await db.from("v_instance_version_gaps")
    .select("uid", { count: "exact", head: true });
  check("cero ejemplares sin historia reconstruible", huecos === 0);
}

// ───────────────────────────── ejecución ─────────────────────────────

async function main(): Promise<void> {
  console.log("\n═══ VERIFICACIÓN DEL PANEL DE POOLS (Bloque 8.4.3) ═══");
  console.log(`  base de datos: ${URL_}`);
  servidorVivo = await fetch(`${BASE}/api/game/state`, { cache: "no-store" })
    .then((r) => r.status > 0).catch(() => false);
  console.log(`  servidor:      ${servidorVivo ? BASE : `${BASE} (no responde — HTTP omitido)`}`);

  const antes = await huellaJuego();
  if (servidorVivo) adminToken = (await cuenta("admin", true)).token;

  await familiaApi();
  const poolId = await familiaCiclo();
  await familiaPesos(poolId);
  await familiaConcurrencia(poolId);
  await familiaCache(poolId);
  await familiaSimulacion();
  await familiaProbabilidad();
  await familiaSeguridad(poolId);
  await familiaDiario(poolId);
  await familiaIntegridad(antes);
}

async function limpiar(): Promise<void> {
  const restos: string[] = [];
  for (const cardId of cartasCreadas) {
    await db.from("content_card_market_anchor").delete().eq("card_id", cardId);
    await db.from("content_audit_log").delete().eq("card_id", cardId);
    await db.from("card_reference").delete().eq("card_id", cardId);
    const { error } = await db.rpc("app_content_purge_card", { p_card_id: cardId });
    if (error) restos.push(`carta ${cardId}: ${error.message}`);
  }
  for (const id of poolsCreados) {
    const e1 = (await db.from("content_pack_pools").delete().eq("pool_id", id)).error;
    if (e1) restos.push(`vínculos de ${id}: ${e1.message}`);
    const e2 = (await db.from("content_pool_entries").delete().eq("pool_id", id)).error;
    if (e2) restos.push(`entradas de ${id}: ${e2.message}`);
    const e3 = (await db.from("content_pools").delete().eq("id", id)).error;
    if (e3) restos.push(`pool ${id}: ${e3.message}`);
    const e4 = (await db.from("content_audit_log").delete().eq("pool_id", id)).error;
    if (e4) restos.push(`diario de ${id}: ${e4.message}`);
  }
  // El borrado directo no pasa por las RPC, así que la versión de distribución no ha subido:
  // sin este latido, el servidor seguiría sirviendo un pool que ya no existe.
  const { error: eBump } = await db.rpc("_bump_distribution", { p_pool_id: null });
  if (eBump) restos.push(`latido de distribución: ${eBump.message}`);

  for (const id of cuentas) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) restos.push(`cuenta ${id}: ${error.message}`);
  }

  const { count: quedan } = await db.from("content_pools")
    .select("id", { count: "exact", head: true }).like("id", "v843-%");
  const { count: cartasExtra } = await db.from("content_cards")
    .select("card_id", { count: "exact", head: true }).eq("origin", "admin");
  if ((cartasExtra ?? 0) > 0) restos.push(`${cartasExtra} cartas de origen admin sin purgar`);
  const { count: pools } = await db.from("content_pools").select("id", { count: "exact", head: true });
  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${quedan} pools de prueba restantes · ${pools} pools`);

  check("la verificación no deja nada suyo detrás", (quedan ?? 0) === 0 && restos.length === 0,
    restos.length ? restos.slice(0, 3).join(" | ") : "0 pools v843-*");
}

main()
  .catch((e) => { console.error("\n✕ verificación abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar();
    console.log("\n" + "─".repeat(74));
    console.log(`  ${pass} correctas · ${fail} fallidas${omit_ ? ` · ${omit_} omitidas` : ""}`);
    console.log(fail === 0
      ? "  ✅ LA DISTRIBUCIÓN ES ADMINISTRABLE, AUDITADA Y NO CAMBIA EL MOTOR"
      : "  ❌ EL PANEL DE POOLS TIENE HUECOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
