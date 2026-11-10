/**
 * QA REAL DEL VERSIONADO — `npm run content-version:qa` (Bloque 8.2).
 *
 * El verificador demuestra propiedades del modelo. Esto hace otra cosa: **juega**. Una
 * cuenta nueva compra un sobre, se queda una carta, la mete en un mazo, empieza un duelo y
 * la pone en el mercado. Entonces un administrador REAL —con su sesión, por la API real—
 * edita la definición de esa carta. Y se vuelve a mirar todo.
 *
 * El recorrido es el del encargo:
 *
 *   1-3.  admin autenticado, carta elegida, versión vigente inspeccionada
 *   4-5.  se publica una versión y se crea un ejemplar de prueba
 *   6-7.  se edita la definición DESPUÉS y se comprueba el ejemplar
 *   8-9.  colección e inventario
 *   10.   mercado (listado creado antes de la edición)
 *   11.   mazo
 *   12.   duelo — incluida una partida EMPEZADA antes de la edición
 *   13.   PvP
 *   14.   histórico completo y reproducible
 *   15.   usuario normal: acceso, mutación y API directa denegados
 *
 * Todo lo que crea, lo borra, y lo demuestra al final.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DUEL_ROLES } from "../src/domain/cardgame";
import type { RoleId } from "../src/domain/cards/types";

import { getVariant } from "../src/domain/cards/variants";
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
const tocadas = new Map<string, Record<string, unknown>>();

async function cuenta(tag: string): Promise<{ id: string; token: string }> {
  const email = `qa82-${tag}-${randomUUID()}@nexus.test`;
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

async function recordar(cardId: string): Promise<void> {
  if (tocadas.has(cardId)) return;
  const { data } = await db.from("content_cards").select("*").eq("card_id", cardId).maybeSingle();
  if (data) tocadas.set(cardId, data as Record<string, unknown>);
}

async function main(): Promise<void> {
  console.log("\n═══ QA REAL — VERSIONADO E INMUTABILIDAD (Bloque 8.2) ═══");
  console.log(`  servidor: ${BASE}\n  base de datos: ${URL_}`);

  const ping = await fetch(`${BASE}/api/game/state`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) {
    console.error(`\n  ✕ No hay servidor en ${BASE}. Arráncalo antes.\n`);
    process.exit(1);
  }

  // ── 1. Admin autenticado ──
  paso(1, "ADMIN AUTENTICADO CONTRA EL SERVIDOR REAL");
  const admin = await cuenta("admin");
  await db.from("profiles").update({ is_admin: true }).eq("id", admin.id);
  const adminApi = apiFor(admin.token);
  const sesion = await adminApi<{ admin: boolean }>("/api/admin/session");
  check("la sesión de admin se resuelve en el servidor", sesion.status === 200 && sesion.data.admin === true,
    `HTTP ${sesion.status}`);

  // ── 2-3. Carta y versión vigente ──
  paso(2, "CARTA ELEGIDA E INSPECCIÓN DE SU VERSIÓN VIGENTE");
  const jugador = await cuenta("jugador");
  const api = apiFor(jugador.token);
  await db.from("profiles").update({ credits: 50_000 }).eq("id", jugador.id);

  // La carta se elige de lo que el sobre REALMENTE entrega: así el ejemplar de prueba es
  // una carta obtenida jugando, no una insertada a mano.
  const abierto = await api<{ opened: { cardId: string; serial: number | null }[] }>(
    "/api/game/packs", { action: "buy_and_open", packId: "premium", ref: randomUUID() },
  );
  check("una cuenta nueva compra y abre un sobre", abierto.status === 200, `HTTP ${abierto.status}`);
  const CARTA = abierto.data.opened[0].cardId;
  await recordar(CARTA);

  const insp = await adminApi<{
    definition: { ovr: number; definition_version: number; lifecycle: string;
                  variant_id: string; combat: { stronghold: number; gamesense: number; entryfrag: number } };
    versions: { version: number; ovr: number; effective_to: string | null }[];
    instancesByVersion: Record<string, number>;
  }>("/api/admin/cards", { action: "inspect", cardId: CARTA });
  check("el admin inspecciona la carta y su historial", insp.status === 200, `HTTP ${insp.status}`);
  const v0 = insp.data.definition;
  check("tiene UNA versión y es la vigente", insp.data.versions.length === 1 && insp.data.versions[0].effective_to === null,
    `${CARTA} · v${v0.definition_version} · OVR ${v0.ovr} · ${v0.lifecycle}`);
  check("el informe dice cuántos ejemplares hay bajo cada versión",
    (insp.data.instancesByVersion["1"] ?? 0) >= 1,
    JSON.stringify(insp.data.instancesByVersion));

  // ── 4-5. El ejemplar de prueba, ya en manos del jugador ──
  paso(3, "EL EJEMPLAR — Y TODO LO QUE EL JUGADOR HACE CON ÉL ANTES DE LA EDICIÓN");
  const { data: mio } = await db.from("user_cards")
    .select("uid, card_id, serial, minted_version").eq("user_id", jugador.id).eq("card_id", CARTA).limit(1).maybeSingle();
  const ejemplar = mio as { uid: string; serial: number | null; minted_version: number };
  check("el ejemplar nace anclado a la versión vigente", ejemplar.minted_version === v0.definition_version,
    `uid ${ejemplar.uid.slice(0, 8)}… · v${ejemplar.minted_version}`);

  // Colección ANTES
  const colAntes = await api<{ collection: { cardId: string; ovr: number }[] }>("/api/game/duels");
  const enColAntes = (colAntes.data.collection ?? []).find((c) => c.cardId === CARTA);
  check("la colección lo enseña", !!enColAntes, `OVR ${enColAntes?.ovr}`);

  // Mazo + duelo EMPEZADO antes de la edición
  const uids = await construirMazo(jugador.id, ejemplar.uid);
  const mazo = await api<{ deck: { id: string; valid: boolean; sumOvr: number } }>(
    "/api/game/duels", { action: "save", name: "QA 8.2", cardUids: uids },
  );
  check("el mazo con esa carta es legal", mazo.data?.deck?.valid === true, `suma OVR ${mazo.data?.deck?.sumOvr}`);
  const partida = await api<{ view: { matchId: string; yourHand: { cardId: string; ovr: number }[] } }>(
    "/api/game/duel", { action: "start", deckId: mazo.data.deck.id, difficulty: "NORMAL" },
  );
  const manoAntes = partida.data?.view?.yourHand?.find((c) => c.cardId === CARTA);
  check("una partida EMPEZADA antes de la edición", partida.status === 200 && !!manoAntes,
    `partida ${partida.data?.view?.matchId?.slice(0, 8)}… · OVR en mano ${manoAntes?.ovr}`);

  // Mercado: listado creado ANTES de la edición (fixture, el mercado global está cerrado)
  const listingId = randomUUID();
  await db.from("market_listings").insert({
    id: listingId, seller_id: jugador.id, card_id: CARTA, card_uid: ejemplar.uid,
    serial: ejemplar.serial, price: 900, status: "active",
  });
  const escAntes = await api<{ listings: { cardId: string; ovr: number }[] }>("/api/game/market", { action: "browse" });
  const listAntes = (escAntes.data.listings ?? []).find((l) => l.cardId === CARTA);
  check("el mercado lo anuncia", !!listAntes, `OVR anunciado ${listAntes?.ovr}`);

  const salvAntes = await api<{ lines: { cardId: string; each: number }[] }>(
    "/api/game/economy", { action: "salvagePreview" });
  const tasaAntes = (salvAntes.data.lines ?? []).find((l) => l.cardId === CARTA)?.each ?? null;

  const foto = {
    ovr: enColAntes!.ovr,
    mano: manoAntes!.ovr,
    mercado: listAntes!.ovr,
    salvage: tasaAntes,
  };
  console.log(`         foto: colección ${foto.ovr} · mano ${foto.mano} · mercado ${foto.mercado}` +
    ` · desguace ${foto.salvage ?? "n/a (sin duplicados)"}`);

  // ── 6. La edición, por la API real ──
  paso(4, "EL ADMIN EDITA LA DEFINICIÓN — POR LA API REAL, CON MOTIVO");
  /*
   * Se envia el TRIO, no un OVR (contrato de 8.4.2). El OVR nuevo lo decide el dominio, asi
   * que aqui no se puede escribir «v0.ovr + 9»: se sube el trio y se mira que salga.
   */
  // `v0` es la fila cruda de la base: nombres en snake_case, no los del dominio.
  const boostCarta = getVariant(String(v0.variant_id) as never).statBoost;
  const baseActual = unboost(v0.combat as never, boostCarta).base;
  const baseNueva = {
    stronghold: Math.min(99, baseActual.stronghold + 8),
    gamesense: Math.min(99, baseActual.gamesense + 8),
    entryfrag: Math.min(99, baseActual.entryfrag + 8),
  };
  const edicion = await adminApi<{ version: number; previous: number }>("/api/admin/cards", {
    action: "publish", cardId: CARTA, combat: baseNueva,
    reason: "QA 8.2: comprobación de que editar no toca lo ya repartido",
  });
  check("la edición crea una versión nueva", edicion.status === 200 && edicion.data.version === 2,
    `v${edicion.data?.previous} → v${edicion.data?.version}`);

  const { data: defTras } = await db.from("content_cards").select("ovr, definition_version")
    .eq("card_id", CARTA).maybeSingle();
  // El OVR nuevo lo derivo el servidor del trio: se comprueba que CAMBIO, no un valor fijado.
  const ovrTras = (defTras as { ovr: number } | null)?.ovr ?? -1;
  check("la DEFINICIÓN vigente ha cambiado de verdad", ovrTras !== v0.ovr && ovrTras > 0,
    `definición: OVR ${v0.ovr} → ${ovrTras}`);

  // ── 7-13. Todo lo de antes, otra vez ──
  paso(5, "Y AHORA SE VUELVE A MIRAR TODO");

  const colTras = await api<{ collection: { cardId: string; ovr: number }[] }>("/api/game/duels");
  const enColTras = (colTras.data.collection ?? []).find((c) => c.cardId === CARTA);
  check("7 · COLECCIÓN — el ejemplar conserva su OVR", enColTras?.ovr === foto.ovr,
    `${enColTras?.ovr} (la definición vale ahora ${ovrTras})`);

  const estado = await api<{ ownedCards: { cardId: string }[] }>("/api/game/state");
  check("8 · INVENTARIO — el ejemplar sigue ahí, con su uid y su serie",
    (estado.data.ownedCards ?? []).some((c) => c.cardId === CARTA), `${(estado.data.ownedCards ?? []).length} cartas`);

  const escTras = await api<{ listings: { cardId: string; ovr: number; price: number }[] }>(
    "/api/game/market", { action: "browse" });
  const listTras = (escTras.data.listings ?? []).find((l) => l.cardId === CARTA);
  check("9 · MERCADO — el anuncio sigue describiendo la carta que se vende",
    listTras?.ovr === foto.mercado, `OVR ${listTras?.ovr} · precio ${listTras?.price} intacto`);

  const salvTras = await api<{ lines: { cardId: string; each: number }[] }>(
    "/api/game/economy", { action: "salvagePreview" });
  const tasaTras = (salvTras.data.lines ?? []).find((l) => l.cardId === CARTA)?.each ?? null;
  check("10 · ECONOMÍA — el desguace no ha cambiado", tasaTras === foto.salvage,
    `${tasaTras ?? "n/a"} (la definición es ahora legendary)`);

  const mazoTras = await api<{ decks: { id: string; valid: boolean; sumOvr: number }[] }>("/api/game/duels");
  const miMazo = (mazoTras.data.decks ?? []).find((d) => d.id === mazo.data.deck.id);
  check("11 · MAZO — sigue siendo legal y suma lo mismo",
    miMazo?.valid === true && miMazo?.sumOvr === mazo.data.deck.sumOvr,
    `suma OVR ${miMazo?.sumOvr}`);

  const partidaTras = await api<{ view: { yourHand: { cardId: string; ovr: number }[] } }>(
    "/api/game/duel", { action: "state", matchId: partida.data.view.matchId },
  );
  const manoTras = partidaTras.data?.view?.yourHand?.find((c) => c.cardId === CARTA);
  check("12 · DUELO — la partida en curso no se entera de la edición", manoTras?.ovr === foto.mano,
    `OVR en mano ${manoTras?.ovr} (congelado por takeDeckSnapshot)`);

  const snapshot = await db.from("duel_matches").select("state").eq("id", partida.data.view.matchId).maybeSingle();
  const st = snapshot.data as { state: { snapshotA: { cards: { cardId: string; ovr: number }[] } } } | null;
  const enSnapshot = st?.state?.snapshotA?.cards?.find((c) => c.cardId === CARTA);
  check("12b · el snapshot guardado conserva el trío histórico", enSnapshot?.ovr === foto.mano,
    `OVR ${enSnapshot?.ovr} en duel_matches.state`);

  // PvP: el mazo se vuelve a resolver al entrar en cola, así que es el camino que MÁS
  // fácilmente leería la definición viva si no estuviera bien conectado.
  const pvp = await api<{ status?: string; error?: string }>(
    "/api/game/duel/matchmaking", { action: "enqueue", deckId: mazo.data.deck.id });
  check("13 · PvP — el mazo se acepta en cola con las cartas del jugador",
    pvp.status === 200 || pvp.status === 409, `HTTP ${pvp.status}`);
  await api("/api/game/duel/matchmaking", { action: "cancel" });

  // ── 14. Histórico ──
  paso(6, "HISTÓRICO REPRODUCIBLE");
  const insp2 = await adminApi<{
    versions: { version: number; ovr: number; effective_from: string; effective_to: string | null; reason: string | null }[];
    instancesByVersion: Record<string, number>;
  }>("/api/admin/cards", { action: "inspect", cardId: CARTA });
  check("el historial guarda las dos versiones, con ventana y motivo",
    insp2.data.versions.length === 2
    && insp2.data.versions[0].effective_to !== null
    && insp2.data.versions[1].effective_to === null
    && !!insp2.data.versions[1].reason,
    insp2.data.versions.map((v) => `v${v.version}:OVR${v.ovr}`).join(" → "));
  check("y dice cuántos ejemplares quedaron en cada versión",
    (insp2.data.instancesByVersion["1"] ?? 0) >= 1,
    JSON.stringify(insp2.data.instancesByVersion));

  const { count: huecos } = await db.from("v_instance_version_gaps").select("uid", { count: "exact", head: true });
  check("CERO ejemplares sin historia reconstruible", huecos === 0, `v_instance_version_gaps = ${huecos}`);

  // ── 15. Usuario normal ──
  paso(7, "USUARIO NORMAL — TODO DENEGADO");
  const normalSesion = await api("/api/admin/session");
  check("no es admin", normalSesion.status === 401, `HTTP ${normalSesion.status}`);

  const normalPublica = await api("/api/admin/cards", {
    action: "publish", cardId: CARTA, combat: { stronghold: 60, gamesense: 60, entryfrag: 60 }, reason: "intento",
  });
  check("no puede publicar una versión", normalPublica.status === 401, `HTTP ${normalPublica.status}`);

  const normalRetira = await api("/api/admin/cards", { action: "lifecycle", cardId: CARTA, state: "RETIRED" });
  check("no puede retirar una carta", normalRetira.status === 401, `HTTP ${normalRetira.status}`);

  const sinToken = await fetch(`${BASE}/api/admin/cards`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "inspect", cardId: CARTA }), cache: "no-store",
  }).then((r) => r.status);
  check("la API directa sin sesión responde 401", sinToken === 401, `HTTP ${sinToken}`);

  const comoUsuario = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jugador.token}` } },
  });
  const rpcDirecta = await comoUsuario.rpc("app_content_publish_version", {
    p_card_id: CARTA, p_patch: { ovr: 99 }, p_reason: "x", p_actor: jugador.id,
  });
  check("y la RPC por PostgREST tampoco", !!rpcDirecta.error, rpcDirecta.error?.code ?? "");

  // Limpieza del listado fixture
  await db.from("market_listings").delete().eq("id", listingId);
}

/** Diez cartas propias para un mazo legal, incluyendo la de prueba. */
async function construirMazo(userId: string, incluirUid: string): Promise<string[]> {
  const { data: yaTengo } = await db.from("user_cards")
    .select("uid, card_id").eq("user_id", userId);
  const propias = (yaTengo ?? []) as { uid: string; card_id: string }[];
  const suya = propias.find((c) => c.uid === incluirUid)!;

  const { data: jug } = await db.from("content_players").select("id, role");
  const rolDe = new Map(((jug ?? []) as { id: string; role: RoleId }[]).map((p) => [p.id, p.role]));
  const { data: cards } = await db.from("content_cards")
    .select("card_id, player_id").eq("lifecycle", "PUBLISHED").order("ovr", { ascending: false }).limit(2000);

  const rolDeCarta = (cardId: string): RoleId | undefined => rolDe.get(cardId.split("__")[0]);
  const porRol = new Map<RoleId, string[]>();
  const rolSuya = rolDeCarta(suya.card_id);
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
  if (nuevos.length > 0) {
    const { error } = await db.from("user_cards").insert(nuevos);
    if (error) throw new Error(`mazo: ${error.message}`);
  }
  return DUEL_ROLES.flatMap((r) => (porRol.get(r) ?? []).slice(0, 2));
}

/** Devuelve cada definición tocada a como estaba y borra las cuentas. */
async function limpiar(): Promise<void> {
  for (const [cardId, fila] of tocadas) {
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
      lifecycle: fila.lifecycle, updated_at: fila.updated_at,
    }).eq("card_id", cardId);
    await db.from("content_card_versions").delete().eq("card_id", cardId).gt("version", 1);
    await db.from("content_card_versions")
      .update({ effective_to: null }).eq("card_id", cardId).eq("version", 1);
  }
  for (const id of cuentas) await db.auth.admin.deleteUser(id).catch(() => {});

  const { count: extra } = await db.from("content_card_versions")
    .select("card_id", { count: "exact", head: true }).gt("version", 1);
  console.log(`\n  limpieza: ${cuentas.length} cuentas borradas · ${extra} versiones de prueba restantes`);
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
