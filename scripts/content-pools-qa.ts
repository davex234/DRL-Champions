/**
 * QA REAL DE POOLS Y DISTRIBUCIÓN — `npm run content-pools:qa` (Bloque 8.3).
 *
 * El verificador demuestra propiedades. Esto configura un pool de verdad, por la API de
 * administración real, y abre sobres reales contra él.
 *
 * El recorrido es el del encargo:
 *
 *   1-4.  crear pool, añadir cartas, poner pesos, publicar
 *   5-7.  abrir sobre real y comprobar que usa la configuración persistida y su distribución
 *   8-11. modificar el pool, republicar, comprobar la invalidación de caché y el resultado
 *  12-16. retirar una carta: fuera de nuevos drops, pero colección, inventario, mercado,
 *         mazos, duelo y PvP siguen funcionando con las instancias antiguas
 *    17.  D-1: publicar una versión sincroniza el ancla del mercado
 *
 * Todo lo que crea, lo borra, y lo demuestra al final.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DUEL_ROLES } from "../src/domain/cardgame";
import type { RoleId } from "../src/domain/cards/types";

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
const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
if (!URL_ || !SERVICE || !ANON) { console.error("Falta configuración de Supabase"); process.exit(1); }

const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const paso = (n: number, s: string): void => console.log(`\n${n}. ${s}\n${"─".repeat(72)}`);

const cuentas: string[] = [];
const poolsCreados: string[] = [];
const vinculos: { pack: string; pool: string }[] = [];
/** Vínculos que la QA quita temporalmente y tiene que devolver al terminar. */
const rebind: { pack: string; pool: string; priority: number }[] = [];
const cartasTocadas = new Map<string, Record<string, unknown>>();
/** El sobre de trabajo. Se le añade un pool de prueba con prioridad más alta que el suyo. */
const PACK = "estandar";

async function cuenta(tag: string): Promise<{ id: string; token: string }> {
  const email = `qa83-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  cuentas.push(data.user.id);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`login: ${s.error?.message}`);
  return { id: data.user.id, token: s.data.session.access_token };
}

type Api = <T = unknown>(path: string, body?: unknown) => Promise<{ status: number; data: T }>;
const apiFor = (token: string): Api => async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const t = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(t); } catch { data = t; }
  return { status: res.status, data: data as never };
};

async function recordarCarta(cardId: string): Promise<void> {
  if (cartasTocadas.has(cardId)) return;
  const { data } = await db.from("content_cards").select("*").eq("card_id", cardId).maybeSingle();
  if (data) cartasTocadas.set(cardId, data as Record<string, unknown>);
}

/** Abre N sobres reales y devuelve el recuento por carta. */
async function abrirSobres(api: Api, userId: string, n: number): Promise<Map<string, number>> {
  await db.from("profiles").update({ credits: 5_000_000 }).eq("id", userId);
  const cuenta = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const r = await api<{ opened: { cardId: string }[] }>(
      "/api/game/packs", { action: "buy_and_open", packId: PACK, ref: randomUUID() });
    for (const c of r.data?.opened ?? []) cuenta.set(c.cardId, (cuenta.get(c.cardId) ?? 0) + 1);
  }
  return cuenta;
}

async function main(): Promise<void> {
  console.log("\n═══ QA REAL — POOLS Y DISTRIBUCIÓN (Bloque 8.3) ═══");
  console.log(`  servidor: ${BASE}\n  base de datos: ${URL_}`);
  const ping = await fetch(`${BASE}/api/game/state`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) { console.error(`\n  ✕ No hay servidor en ${BASE}.\n`); process.exit(1); }

  const admin = await cuenta("admin");
  await db.from("profiles").update({ is_admin: true }).eq("id", admin.id);
  const adminApi = apiFor(admin.token);
  const jugador = await cuenta("jugador");
  const api = apiFor(jugador.token);

  // ── 1-3. Crear pool, añadir cartas, poner pesos ──
  paso(1, "CREAR UN POOL, AÑADIR CARTAS Y PONER PESOS — POR LA API REAL");
  const poolId = `qa83-${randomUUID().slice(0, 8)}`;
  poolsCreados.push(poolId);

  const crear = await adminApi<{ poolId: string; version: number }>("/api/admin/pools", {
    action: "upsert",
    pool: { id: poolId, name: "QA 8.3", mode: "EXPLICIT", description: "pool de prueba" },
    reason: "QA 8.3",
  });
  check("el admin crea un pool", crear.status === 200, `HTTP ${crear.status} · v${crear.data?.version}`);

  // Tres cartas comunes del pool del sobre, para que el resultado sea observable en pocas
  // aperturas: con 772 candidatas uniformes haría falta una simulación enorme.
  const { data: comunes } = await db.from("content_pool_entries")
    .select("card_id, content_cards!inner(rarity_bucket, lifecycle)")
    .eq("pool_id", `pack-${PACK}`).eq("content_cards.rarity_bucket", "common")
    .eq("content_cards.lifecycle", "PUBLISHED").limit(3);
  const tres = ((comunes ?? []) as { card_id: string }[]).map((r) => r.card_id);
  check("se eligen 3 cartas comunes del pool del sobre", tres.length === 3, tres.join(", "));

  // Que estén PUBLICADAS de verdad ahora mismo: una ejecución anterior pudo dejar una
  // retirada y el servidor tarda hasta 5 s en enterarse de que volvió.
  const { data: est } = await db.from("content_cards")
    .select("card_id, lifecycle").in("card_id", tres);
  const publicadas = ((est ?? []) as { lifecycle: string }[]).every((r) => r.lifecycle === "PUBLISHED");
  check("las tres están PUBLISHED", publicadas,
    ((est ?? []) as { card_id: string; lifecycle: string }[]).map((r) => `${r.card_id.split("__")[0]}:${r.lifecycle}`).join(" "));

  const pesos = [10, 20, 5];
  const entradas = await adminApi<{ entries: number; version: number }>("/api/admin/pools", {
    action: "setEntries", poolId, reason: "QA 8.3: pesos 10/20/5",
    entries: tres.map((cardId, i) => ({ cardId, weight: pesos[i] })),
  });
  check("se fijan las entradas con pesos 10/20/5", entradas.status === 200,
    `${entradas.data?.entries} entradas · v${entradas.data?.version}`);

  // ── 4. Publicar ──
  paso(2, "PUBLICAR LA CONFIGURACIÓN");
  const publicar = await adminApi<{ to: string; version: number }>("/api/admin/pools", {
    action: "publish", poolId, state: "ACTIVE",
  });
  check("el pool pasa a ACTIVE", publicar.status === 200 && publicar.data?.to === "ACTIVE",
    `v${publicar.data?.version}`);

  /*
   * DESVINCULAR PRIMERO EL POOL MIGRADO, y merece explicación porque esta QA se equivocó
   * aquí antes de aprenderlo:
   *
   * cuando un sobre tiene VARIOS pools, sus conjuntos se UNEN. Es lo que hace posible
   * «pool base + pool de evento» sin duplicar cartas, que es justo lo que el encargo pide
   * en la Fase 9. La `priority` decide quién manda en el PESO de una carta que esté en dos
   * pools, no quién manda en la pertenencia.
   *
   * Así que dejar el pool migrado de 772 cartas y añadir uno de 3 da 772, no 3 — y es el
   * comportamiento correcto. Para reducir el sobre hay que quitarle el otro pool.
   */
  const desvincular = await adminApi("/api/admin/pools", {
    action: "unbind", packId: PACK, poolId: `pack-${PACK}`,
  });
  rebind.push({ pack: PACK, pool: `pack-${PACK}`, priority: 100 });
  check("se desvincula el pool migrado del sobre", desvincular.status === 200,
    "varios pools se UNEN: para reducir el sobre hay que quitar el otro");

  const bind = await adminApi<{ version: number }>("/api/admin/pools", {
    action: "bind", packId: PACK, poolId, priority: 1,
  });
  vinculos.push({ pack: PACK, pool: poolId });
  check("se vincula el pool de prueba al sobre", bind.status === 200, `v${bind.data?.version}`);

  // La caché del servidor tiene 5 s de TTL: se espera a que caduque para que las aperturas
  // de abajo midan la configuración nueva y no la anterior.
  await new Promise((r) => setTimeout(r, 6000));

  // ── 5-7. Abrir sobres reales ──
  paso(3, "ABRIR SOBRES REALES CONTRA LA CONFIGURACIÓN PERSISTIDA");
  const odds = await adminApi<{
    configurado: boolean; uniforme: boolean; distributionVersion: number;
    buckets: Record<string, { pBucket: number; stock: number; top: { cardId: string; weight: number; pEnBucket: number }[] }>;
  }>("/api/admin/pools", { action: "odds", packId: PACK });
  check("el servidor calcula la probabilidad efectiva", odds.status === 200, `HTTP ${odds.status}`);
  check("el sobre está configurado y ya NO es uniforme",
    odds.data?.configurado === true && odds.data?.uniforme === false,
    `distributionVersion ${odds.data?.distributionVersion}`);
  const common = odds.data?.buckets?.common;
  check("el pool del sobre se ha reducido a las 3 cartas", common?.stock === 3,
    `stock común: ${common?.stock}`);
  const esperadas = new Map(common?.top?.map((t) => [t.cardId, t.pEnBucket]) ?? []);
  check("y sus probabilidades son 10/35, 20/35 y 5/35",
    tres.every((id, i) => Math.abs((esperadas.get(id) ?? 0) - pesos[i] / 35) < 1e-9),
    tres.map((id, i) => `${id.split("__")[0]}=${((esperadas.get(id) ?? 0) * 100).toFixed(1)}%`).join(" "));

  const N = 60;
  const salidas = await abrirSobres(api, jugador.id, N);
  const soloDelPool = [...salidas.keys()].every((id) => tres.includes(id));
  check(`abrir ${N} sobres reales solo entrega cartas del pool configurado`, soloDelPool,
    `${salidas.size} cartas distintas: ${[...salidas.keys()].map((s) => s.split("__")[0]).join(", ")}`);

  const total = [...salidas.values()].reduce((a, b) => a + b, 0);
  const obs = tres.map((id) => (salidas.get(id) ?? 0) / total);
  console.log(`         observado: ${tres.map((id, i) => `${id.split("__")[0]} ${(obs[i] * 100).toFixed(1)}%`).join(" · ")}` +
    ` (esperado ${pesos.map((w) => (w / 35 * 100).toFixed(1) + "%").join(" · ")})`);
  check("la carta de peso 20 sale más que la de peso 5",
    (salidas.get(tres[1]) ?? 0) > (salidas.get(tres[2]) ?? 0),
    `${salidas.get(tres[1])} vs ${salidas.get(tres[2])} en ${total} cartas`);

  // ── 8-11. Modificar, republicar, invalidación de caché ──
  paso(4, "MODIFICAR EL POOL Y COMPROBAR QUE EL SERVIDOR SE ENTERA");
  const soloUna = tres[2];
  const cambio = await adminApi<{ version: number }>("/api/admin/pools", {
    action: "setEntries", poolId, reason: "QA 8.3: dejar una sola carta",
    entries: [{ cardId: soloUna, weight: 1 }],
  });
  check("se reduce el pool a UNA carta", cambio.status === 200, `v${cambio.data?.version}`);
  check("la versión de distribución ha subido", (cambio.data?.version ?? 0) > (bind.data?.version ?? 0),
    `v${bind.data?.version} → v${cambio.data?.version}`);

  // El TTL de la caché es de 5 s: se espera a que caduque para probar la invalidación REAL,
  // sin reiniciar el proceso ni tocar nada por dentro.
  await new Promise((r) => setTimeout(r, 6000));

  const salidas2 = await abrirSobres(api, jugador.id, 12);
  check("tras republicar, el sobre entrega SOLO la carta nueva",
    [...salidas2.keys()].length === 1 && salidas2.has(soloUna),
    `${[...salidas2.keys()].map((s) => s.split("__")[0]).join(", ")} — caché invalidada sin reiniciar`);

  // ── 12-16. Retirar una carta ──
  paso(5, "RETIRAR UNA CARTA: FUERA DE NUEVOS DROPS, PERO NADA SE ROMPE");
  await recordarCarta(soloUna);
  const { data: instAntes } = await db.from("user_cards")
    .select("uid, card_id, minted_version").eq("user_id", jugador.id).eq("card_id", soloUna).limit(1).maybeSingle();
  const ejemplar = instAntes as { uid: string; minted_version: number } | null;
  check("el jugador posee un ejemplar de esa carta", !!ejemplar,
    ejemplar ? `uid ${ejemplar.uid.slice(0, 8)}… v${ejemplar.minted_version}` : "no lo tiene");

  // Un mazo y un duelo ANTES de retirar.
  const uids = await construirMazo(jugador.id, ejemplar!.uid);
  const mazo = await api<{ deck: { id: string; valid: boolean; sumOvr: number } }>(
    "/api/game/duels", { action: "save", name: "QA 8.3", cardUids: uids });
  check("se construye un mazo con esa carta", mazo.data?.deck?.valid === true, `suma OVR ${mazo.data?.deck?.sumOvr}`);
  const partida = await api<{ view: { matchId: string; yourHand: { cardId: string }[] } }>(
    "/api/game/duel", { action: "start", deckId: mazo.data.deck.id, difficulty: "NORMAL" });
  check("y se empieza un duelo", partida.status === 200, `partida ${partida.data?.view?.matchId?.slice(0, 8)}…`);

  const listingId = randomUUID();
  await db.from("market_listings").insert({
    id: listingId, seller_id: jugador.id, card_id: soloUna, card_uid: ejemplar!.uid,
    serial: null, price: 400, status: "active",
  });

  const retirar = await adminApi("/api/admin/cards", {
    action: "lifecycle", cardId: soloUna, state: "RETIRED", reason: "QA 8.3",
  });
  check("el admin RETIRA la carta", retirar.status === 200, `HTTP ${retirar.status}`);
  await new Promise((r) => setTimeout(r, 6000));

  const salidas3 = await abrirSobres(api, jugador.id, 8);
  check("12 · la carta retirada NO sale en nuevos sobres", !salidas3.has(soloUna),
    salidas3.size === 0 ? "el sobre queda sin stock en ese pool (correcto)" : `${salidas3.size} otras cartas`);

  const coleccion = await api<{ collection: { cardId: string }[] }>("/api/game/duels");
  check("13 · COLECCIÓN — la sigue enseñando",
    (coleccion.data.collection ?? []).some((c) => c.cardId === soloUna));

  const estado = await api<{ ownedCards: { cardId: string }[] }>("/api/game/state");
  check("14 · INVENTARIO — el ejemplar sigue ahí",
    (estado.data.ownedCards ?? []).some((c) => c.cardId === soloUna));

  const escaparate = await api<{ listings: { cardId: string; ovr: number }[] }>(
    "/api/game/market", { action: "browse" });
  check("15 · MERCADO — el listado sigue visible y tasando",
    (escaparate.data.listings ?? []).some((l) => l.cardId === soloUna),
    `${(escaparate.data.listings ?? []).length} listados`);

  const mazoTras = await api<{ decks: { id: string; valid: boolean }[] }>("/api/game/duels");
  check("16 · MAZO — sigue siendo legal",
    (mazoTras.data.decks ?? []).find((d) => d.id === mazo.data.deck.id)?.valid === true);

  const partidaTras = await api<{ view: { yourHand: { cardId: string }[] } }>(
    "/api/game/duel", { action: "state", matchId: partida.data.view.matchId });
  check("17 · DUELO — la partida en curso sigue teniendo la carta",
    (partidaTras.data?.view?.yourHand ?? []).some((c) => c.cardId === soloUna));

  const pvp = await api("/api/game/duel/matchmaking", { action: "enqueue", deckId: mazo.data.deck.id });
  check("18 · PvP — el mazo se acepta en cola", pvp.status === 200 || pvp.status === 409, `HTTP ${pvp.status}`);
  await api("/api/game/duel/matchmaking", { action: "cancel" });

  await db.from("market_listings").delete().eq("id", listingId);

  // ── 17. D-1 ──
  paso(6, "D-1 — PUBLICAR UNA VERSIÓN SINCRONIZA EL ANCLA DEL MERCADO");
  const { data: otra } = await db.from("content_cards")
    .select("card_id, ovr").eq("lifecycle", "PUBLISHED").limit(1).maybeSingle();
  const cardD1 = (otra as { card_id: string; ovr: number }).card_id;
  await recordarCarta(cardD1);

  await db.from("card_reference").delete().eq("card_id", cardD1);
  const { count: antesRef } = await db.from("card_reference")
    .select("card_id", { count: "exact", head: true }).eq("card_id", cardD1);
  check("el ancla de esa carta no existe antes de publicar", antesRef === 0);

  const { data: filaD1 } = await db.from("content_cards")
    .select("variant_id, combat, stat_boost").eq("card_id", cardD1).maybeSingle();
  const fd = filaD1 as { variant_id: string; combat: { stronghold: number; gamesense: number; entryfrag: number }; stat_boost: number };
  const baseD1 = (() => {
    const b = unboost(fd.combat, fd.stat_boost).base;
    return { stronghold: Math.min(99, b.stronghold + 6), gamesense: b.gamesense, entryfrag: b.entryfrag };
  })();

  const pub = await adminApi<{ version: number; marketAnchor: { fairValue: number } }>("/api/admin/cards", {
    // 8.4.2: se escribe el trio; el OVR y el ancla los deriva el servidor.
    action: "publish", cardId: cardD1, combat: baseD1,
    reason: "QA 8.3: comprobar la sincronización del ancla",
  });
  check("se publica una versión nueva", pub.status === 200, `v${pub.data?.version}`);

  const { data: ref } = await db.from("card_reference")
    .select("card_id, ovr, fair_value").eq("card_id", cardD1).maybeSingle();
  const r = ref as { ovr: number; fair_value: number } | null;
  /*
   * El ancla tiene que describir la version NUEVA. Ya no se compara contra «ovr + 5», porque
   * desde 8.4.2 el OVR no se escribe: se deriva del trio. Se compara contra lo que la
   * definicion dice AHORA, que es exactamente lo que el ancla debe reflejar.
   */
  const { data: defTrasPub } = await db.from("content_cards")
    .select("ovr").eq("card_id", cardD1).maybeSingle();
  const ovrVigente = Number((defTrasPub as { ovr: number }).ovr);
  check("D-1 · el ancla del mercado se ha creado y describe la versión NUEVA",
    !!r && r.ovr === ovrVigente,
    r ? `ovr ${r.ovr} = definición ${ovrVigente} · fair_value ${r.fair_value}` : "no se creó");
  check("y coincide con lo que devolvió la API", r?.fair_value === pub.data?.marketAnchor?.fairValue,
    `${pub.data?.marketAnchor?.fairValue}`);
}

/** Diez cartas propias para un mazo legal, incluyendo la de prueba. */
async function construirMazo(userId: string, incluirUid: string): Promise<string[]> {
  const { data: yaTengo } = await db.from("user_cards").select("uid, card_id").eq("user_id", userId);
  const propias = (yaTengo ?? []) as { uid: string; card_id: string }[];
  const suya = propias.find((c) => c.uid === incluirUid)!;
  const { data: jug } = await db.from("content_players").select("id, role");
  const rolDe = new Map(((jug ?? []) as { id: string; role: RoleId }[]).map((p) => [p.id, p.role]));
  const { data: cards } = await db.from("content_cards")
    .select("card_id, player_id").eq("lifecycle", "PUBLISHED").order("ovr", { ascending: false }).limit(2000);

  const porRol = new Map<RoleId, string[]>();
  const rolSuya = rolDe.get(suya.card_id.split("__")[0]);
  const usados = new Set<string>([suya.card_id.split("__")[0]]);
  if (rolSuya) porRol.set(rolSuya, [suya.uid]);

  const nuevos: { uid: string; user_id: string; card_id: string; origin: string }[] = [];
  for (const c of (cards ?? []) as { card_id: string; player_id: string }[]) {
    const rol = rolDe.get(c.player_id);
    if (!rol || usados.has(c.player_id)) continue;
    const lista = porRol.get(rol) ?? [];
    if (lista.length >= 2) continue;
    const uid = randomUUID();
    nuevos.push({ uid, user_id: userId, card_id: c.card_id, origin: "admin" });
    lista.push(uid); porRol.set(rol, lista); usados.add(c.player_id);
  }
  if (nuevos.length) {
    const { error } = await db.from("user_cards").insert(nuevos);
    if (error) throw new Error(`mazo: ${error.message}`);
  }
  return DUEL_ROLES.flatMap((r) => (porRol.get(r) ?? []).slice(0, 2));
}

/**
 * Borrar y DECIR si no se pudo.
 *
 * El cliente de Supabase no rechaza la promesa cuando la base contesta un error: la resuelve
 * con `{ data, error }`. Por eso un `.then(() => {}, () => {})` no captura nada -- el segundo
 * manejador no llega a ejecutarse nunca -- y la limpieza fallaba en silencio. Se veia solo en
 * el recuento final, que decia "1 pools de prueba restantes" sin explicar por que.
 */
const restos: string[] = [];

async function limpiar(): Promise<void> {
  // Primero se devuelven los vínculos que la QA quitó: dejar un sobre sin su pool migrado
  // sería dejar el juego con una distribución que nadie configuró.
  for (const r of rebind) {
    await db.rpc("app_content_pack_bind", {
      p_pack_id: r.pack, p_pool_id: r.pool, p_priority: r.priority, p_action: "bind", p_actor: null,
    }).then(() => {}, () => {});
  }
  for (const v of vinculos) {
    const { error } = await db.from("content_pack_pools").delete()
      .eq("pack_id", v.pack).eq("pool_id", v.pool);
    if (error) restos.push(`vinculo ${v.pack}<->${v.pool}: ${error.message}`);
  }
  for (const id of poolsCreados) {
    const e1 = (await db.from("content_pool_entries").delete().eq("pool_id", id)).error;
    if (e1) restos.push(`entradas de ${id}: ${e1.message}`);
    const e2 = (await db.from("content_pools").delete().eq("id", id)).error;
    if (e2) restos.push(`pool ${id}: ${e2.message}`);
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
  }
  /*
   * Y AVISAR AL SERVIDOR. Esta limpieza restaura `content_cards` con un UPDATE directo —un
   * atajo de fixture, no un camino de producto— y por tanto NO pasa por las RPC que suben
   * la versión del catálogo. Sin este latido, el proceso que sirve el juego se quedaría con
   * la carta retirada en memoria y la siguiente ejecución mediría un catálogo que ya no
   * existe. Lo aprendió esta misma QA, midiéndolo.
   */
  if (cartasTocadas.size > 0) {
    const { error: eCat } = await db.rpc("_bump_catalog");
    if (eCat) restos.push(`latido de catálogo: ${eCat.message}`);
    await new Promise((r) => setTimeout(r, 6000));
  }
  for (const id of cuentas) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) restos.push(`cuenta ${id}: ${error.message}`);
  }

  /*
   * EL LATIDO DE LA DISTRIBUCIÓN, y merece explicación porque cuesta verlo.
   *
   * Esta limpieza borra el pool de prueba con un DELETE directo, que es un atajo de fixture y
   * no un camino de producto: no pasa por `app_content_pool_*`, así que `_bump_distribution`
   * no corre. Consecuencia: `content_distribution_version` se queda diciendo que hay 13 pools
   * activos y 6865 entradas cuando quedan 12 y 6864 — describe una distribución que ya no
   * existe, y su `checksum` deja de ser reproducible.
   *
   * `version` sigue subiendo por otros caminos, así que el juego no se rompe. Lo que se
   * estropea es la auditabilidad, que es justo lo que estas tablas existen para dar.
   *
   * Lo destapó el bloque 8.4.3 al ir a construir el panel y encontrarse los contadores
   * descuadrados.
   */
  const { error: eDist } = await db.rpc("_bump_distribution", { p_pool_id: null });
  if (eDist) restos.push(`latido de distribución: ${eDist.message}`);

  const { data: dv } = await db.from("content_distribution_version")
    .select("pools_count, entries_count").eq("id", true).maybeSingle();
  const { count: activosReales } = await db.from("content_pools")
    .select("id", { count: "exact", head: true }).eq("lifecycle", "ACTIVE");
  const { count: entradasReales } = await db.from("content_pool_entries")
    .select("card_id", { count: "exact", head: true });
  const c = dv as { pools_count: number; entries_count: number } | null;
  check("los contadores de distribución describen lo que hay de verdad",
    c?.pools_count === activosReales && c?.entries_count === entradasReales,
    `${c?.pools_count}/${c?.entries_count} vs ${activosReales}/${entradasReales} reales`);

  const { count: poolsExtra } = await db.from("content_pools")
    .select("id", { count: "exact", head: true }).like("id", "qa83-%");
  const { count: versExtra } = await db.from("content_card_versions")
    .select("card_id", { count: "exact", head: true }).gt("version", 1);
  const { count: sobresConPool } = await db.from("content_pack_pools")
    .select("pack_id", { count: "exact", head: true });
  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${poolsExtra} pools de prueba restantes · `
    + `${versExtra} versiones de prueba restantes · ${sobresConPool} vínculos sobre↔pool (deben ser 12)`);

  // Dejar restos ES un fallo: el panel de 8.4.1 lista los pools, y un pool de prueba
  // olvidado aparece ahi como si fuera contenido del juego.
  check("la QA no deja nada suyo detras", (poolsExtra ?? 0) === 0 && restos.length === 0,
    restos.length ? restos.slice(0, 3).join(" | ") : `${poolsExtra} pools qa83-*`);
}

main()
  .catch((e) => { console.error("\n✕ QA abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar();
    console.log("\n" + "─".repeat(72));
    console.log(`  ${pass} correctas · ${fail} fallidas`);
    console.log(fail === 0 ? "  ✅ QA REAL SUPERADA" : "  ❌ QA REAL CON FALLOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
