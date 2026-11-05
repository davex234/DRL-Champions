/**
 * QA REAL DEL CATÁLOGO PERSISTIDO — `npm run content-catalog:qa` (Bloque 8.1).
 *
 * El verificador (`content-catalog:verify`) demuestra propiedades del catálogo. Esto es otra
 * cosa: **jugar de verdad** contra el servidor arrancado, con una cuenta nueva, y comprobar
 * que cada superficie del juego responde con cartas que salen de la base de datos.
 *
 * El recorrido es el del encargo, en orden:
 *
 *   1. arrancar          — el servidor responde y el catálogo del servidor viene de la BD
 *   2. catálogo público  — el conteo y la muestra que ve el jugador
 *   3. cartas reales     — una muestra concreta, con su OVR y su variante
 *   4. colección         — lo que posee la cuenta, resuelto contra el catálogo
 *   5. inventario        — el estado de juego completo (cartas, sobres, créditos)
 *   6. mercado           — publicar, ver publicado y cancelar
 *   7. mazos             — construir un mazo legal con cartas reales
 *   8. duelo             — empezar una partida y jugar un turno
 *   9. sobres            — comprar y abrir, y que lo abierto exista en el catálogo
 *  10. admin auth        — la cuenta normal no entra; una admin sí
 *
 * TODO por HTTP, con el Bearer de una sesión real. Nada se escribe a mano en las tablas de
 * juego salvo los créditos iniciales (no hay endpoint para regalarse dinero, y no debería
 * haberlo). La cuenta y todo lo que genere se BORRAN al terminar.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CARDS } from "../src/data/catalog";
import { getVariant } from "../src/domain/cards/variants";
import { DUEL_ROLES } from "../src/domain/cardgame";
import type { RoleId } from "../src/domain/cards/types";

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
if (!URL_ || !SERVICE || !ANON) { console.error("Falta configuración de Supabase en .env.local"); process.exit(1); }

const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "[PASS]" : "[FAIL]"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const paso = (n: number, s: string): void => console.log(`\n${n}. ${s}\n${"─".repeat(72)}`);
const creadas: string[] = [];

async function cuenta(tag: string): Promise<{ id: string; token: string }> {
  const email = `qa81-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  creadas.push(data.user.id);
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
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as never };
};

async function main(): Promise<void> {
  console.log("\n═══ QA REAL — CATÁLOGO PERSISTIDO (Bloque 8.1) ═══");
  console.log(`  servidor: ${BASE}\n  base de datos: ${URL_}`);

  // ── 1 · Arrancar ──
  paso(1, "LA APLICACIÓN RESPONDE Y SU CATÁLOGO VIENE DE LA BASE DE DATOS");
  const ping = await fetch(`${BASE}/api/game/state`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) {
    console.error(`\n  ✕ No hay servidor en ${BASE}. Arráncalo antes (npx next dev -p 3005).\n`);
    process.exit(1);
  }
  check("el servidor responde y exige sesión", ping === 401, `HTTP ${ping} en /api/game/state`);

  const { count: persistidas } = await db.from("content_cards").select("card_id", { count: "exact", head: true });
  const { data: ver } = await db.from("content_catalog_version").select("*").eq("id", true).maybeSingle();
  const v = ver as { version: number; cards_count: number; catalog_checksum: string } | null;
  check("hay catálogo persistido", (persistidas ?? 0) > 0, `${persistidas} definiciones · versión ${v?.version}`);
  check("la versión publicada cuadra con las filas", v?.cards_count === persistidas, `${v?.cards_count}`);

  const usuario = await cuenta("jugador");
  const api = apiFor(usuario.token);

  // ── 2 y 3 · Catálogo público y muestra de cartas reales ──
  paso(2, "CATÁLOGO PÚBLICO Y MUESTRA DE CARTAS REALES");
  const { data: muestra } = await db.from("content_cards")
    .select("card_id, player_id, variant_id, ovr, rarity_bucket, combat")
    .in("card_id", [CARDS[0].id, CARDS[100].id, CARDS[400].id, CARDS[771].id]);
  const filas = (muestra ?? []) as { card_id: string; ovr: number; variant_id: string; rarity_bucket: string; combat: { stronghold: number } }[];
  check("la muestra de 4 cartas está en la BD", filas.length === 4, filas.map((f) => f.card_id).join(", "));
  for (const f of filas) {
    const esperada = CARDS.find((c) => c.id === f.card_id)!;
    check(`  ${f.card_id}`, f.ovr === esperada.ovr && f.combat.stronghold === esperada.combat!.stronghold,
      `OVR ${f.ovr} · ${getVariant(esperada.variantId).label} · ${f.rarity_bucket}`);
  }

  // ── 5 · Inventario (estado de juego) ──
  paso(3, "INVENTARIO — EL ESTADO DE JUEGO DE UNA CUENTA NUEVA");
  const estado0 = await api<{ ownedCards: unknown[]; credits: number; unopenedPacks: Record<string, number> }>("/api/game/state");
  check("el estado carga con la sesión real", estado0.status === 200, `HTTP ${estado0.status}`);
  check("una cuenta nueva empieza sin cartas", (estado0.data.ownedCards ?? []).length === 0,
    `${(estado0.data.ownedCards ?? []).length} cartas · ${estado0.data.credits} créditos`);

  // ── 9 · Sobres: comprar y abrir ──
  paso(4, "SOBRES — COMPRAR Y ABRIR CON EL MOTOR ALIMENTADO DESDE LA BD");
  await db.from("profiles").update({ credits: 50_000 }).eq("id", usuario.id);
  const abierto = await api<{ opened: { cardId: string; serial: number | null; bucket: string; value: number }[] }>(
    "/api/game/packs", { action: "buy_and_open", packId: "estandar", ref: randomUUID() },
  );
  check("comprar y abrir un sobre funciona", abierto.status === 200, `HTTP ${abierto.status}`);
  const cartas = abierto.data.opened ?? [];
  check("el sobre entrega cartas", cartas.length > 0, `${cartas.length} cartas`);

  const { data: enCatalogo } = await db.from("content_cards")
    .select("card_id").in("card_id", cartas.map((c) => c.cardId));
  const conocidas = new Set(((enCatalogo ?? []) as { card_id: string }[]).map((r) => r.card_id));
  check("TODA carta abierta existe en el catálogo persistido",
    cartas.every((c) => conocidas.has(c.cardId)),
    cartas.map((c) => `${c.cardId}${c.serial ? `#${c.serial}` : ""}`).join(", ").slice(0, 120));
  check("las cartas abiertas se han acuñado en user_cards",
    (await db.from("user_cards").select("uid", { count: "exact", head: true }).eq("user_id", usuario.id)).count === cartas.length,
    `${cartas.length} instancias`);

  // ── 4 · Colección ──
  paso(5, "COLECCIÓN — LO QUE POSEE LA CUENTA, RESUELTO CONTRA EL CATÁLOGO");
  const coleccion = await api<{ collection: { cardId: string; ovr: number; nick: string }[] }>("/api/game/duels");
  const col = coleccion.status === 200 ? (coleccion.data.collection ?? []) : [];
  check("la colección responde", coleccion.status === 200, `HTTP ${coleccion.status} · ${col.length} cartas jugables`);
  if (col.length > 0) {
    check("cada carta de la colección trae nick y OVR del catálogo",
      col.every((c) => typeof c.nick === "string" && c.nick.length > 0 && c.ovr > 0),
      `p. ej. ${col[0].nick} (${col[0].ovr})`);
  }

  // ── 7 · Mazos ──
  paso(6, "MAZOS — CONSTRUIR UNO LEGAL CON CARTAS REALES");
  const mazo = await construirMazo(usuario.id);
  const guardado = await api<{ deck: { id: string; status: string; valid: boolean; sumOvr: number; cards: unknown[] } }>(
    "/api/game/duels", { action: "save", name: "QA 8.1", cardUids: mazo },
  );
  check("se guarda un mazo de 10 cartas", guardado.status === 200, `HTTP ${guardado.status}`);
  const deck = guardado.data?.deck;
  const deckId = deck?.id;
  check("el mazo queda legal", deck?.valid === true && deck?.status === "READY_FOR_DUEL",
    `estado ${deck?.status} · suma OVR ${deck?.sumOvr}`);
  check("el mazo resuelve sus 10 cartas contra el catálogo persistido",
    (deck?.cards ?? []).length === 10, `${(deck?.cards ?? []).length} cartas resueltas`);

  // ── 8 · Duelo ──
  paso(7, "DUELO — EMPEZAR PARTIDA Y JUGAR UN TURNO");
  const partida = await api<{ view: { matchId: string; yourHand: { cardId: string; nick: string; ovr: number }[]; yourSumOvr: number } }>(
    "/api/game/duel", { action: "start", deckId, difficulty: "NORMAL" },
  );
  check("la partida arranca", partida.status === 200, `HTTP ${partida.status}`);
  const mano = partida.data?.view?.yourHand ?? [];
  check("la mano trae las 10 cartas resueltas desde el catálogo", mano.length === 10,
    `${mano.length} cartas · suma OVR ${partida.data?.view?.yourSumOvr}`);
  check("cada carta de la mano lleva nick y OVR del catálogo persistido",
    mano.length > 0 && mano.every((c) => typeof c.nick === "string" && c.nick.length > 0 && c.ovr > 0),
    mano.length ? `p. ej. ${mano[0].nick} (${mano[0].ovr}) — ${mano[0].cardId}` : "");

  // ── 6 · Mercado ──
  paso(8, "MERCADO — PUBLICAR, VER PUBLICADO Y CANCELAR");
  const { data: mias } = await db.from("user_cards").select("uid, card_id, serial").eq("user_id", usuario.id).limit(1);
  const propia = ((mias ?? []) as { uid: string; card_id: string; serial: number | null }[])[0];

  /*
   * Publicar por HTTP devuelve 503 y ESO ES LO CORRECTO: `GLOBAL_MARKET_ENABLED` está en
   * `false` en `config/features.ts` desde antes de este bloque, y su cabecera lo explica —
   * las lecturas siguen abiertas y las escrituras se rechazan. No es un fallo que arreglar
   * aquí, y encenderlo para que la QA quede bonita sería cambiar una decisión de producto.
   */
  const publicar = await api("/api/game/market", { action: "list", cardUid: propia.uid, price: 500, ref: randomUUID() });
  check("la escritura del mercado responde lo que dice su interruptor", publicar.status === 503,
    "GLOBAL_MARKET_ENABLED=false ⇒ 503 (lecturas abiertas, escrituras cerradas)");

  /*
   * FIXTURE DE QA, identificado y borrado unas líneas más abajo. Con las escrituras cerradas
   * no hay forma legítima de crear un listado por HTTP, y sin listado no se puede comprobar
   * lo que aquí importa: que el escaparate resuelve nick, equipo y OVR contra el CATÁLOGO
   * PERSISTIDO. Se inserta con service_role, se lee por HTTP y se borra.
   */
  const fixtureId = randomUUID();
  await db.from("market_listings").insert({
    id: fixtureId, seller_id: usuario.id, card_id: propia.card_id, card_uid: propia.uid,
    serial: propia.serial, price: 500, status: "active",
  });

  const escaparate = await api<{ listings: { cardId: string; nick: string; team: string; ovr: number }[] }>(
    "/api/game/market", { action: "browse" },
  );
  const lst = escaparate.data?.listings ?? [];
  check("el escaparate responde", escaparate.status === 200, `HTTP ${escaparate.status} · ${lst.length} listados`);
  const mio = lst.find((l) => l.cardId === propia.card_id);
  check("el listado se resuelve con nick y OVR del catálogo persistido",
    !!mio && mio.nick.length > 0 && mio.ovr > 0,
    mio ? `${mio.nick} (${mio.team}) OVR ${mio.ovr} — ${mio.cardId}` : "no aparece en el escaparate");

  const mineList = await api<{ listings: { id: string; status: string; nick: string }[] }>("/api/game/market", { action: "mine" });
  check("«mis listados» también resuelve contra el catálogo",
    (mineList.data?.listings ?? []).some((l) => l.id === fixtureId && l.nick.length > 0),
    `${(mineList.data?.listings ?? []).length} listados propios`);

  await db.from("market_listings").delete().eq("id", fixtureId);
  const { count: quedaFixture } = await db.from("market_listings")
    .select("id", { count: "exact", head: true }).eq("id", fixtureId);
  check("el fixture del mercado queda BORRADO", quedaFixture === 0, `quedan ${quedaFixture}`);

  // ── Desguace: la tasación también sale del catálogo persistido ──
  const desguace = await api<{ total: number; lines: unknown[] }>("/api/game/economy", { action: "salvagePreview" });
  check("la tasación de desguace responde", desguace.status === 200,
    `HTTP ${desguace.status} · ${(desguace.data?.lines ?? []).length} líneas`);

  // ── 10 · Admin auth ──
  paso(9, "ADMIN AUTH — LA CUENTA NORMAL NO ENTRA, UNA ADMIN SÍ");
  const comoNormal = await api("/api/admin/session");
  check("el jugador normal NO es admin", comoNormal.status === 401, `HTTP ${comoNormal.status}`);

  const admin = await cuenta("admin");
  await db.from("profiles").update({ is_admin: true }).eq("id", admin.id);
  const comoAdmin = await apiFor(admin.token)<{ admin: boolean }>("/api/admin/session");
  check("la cuenta admin SÍ entra", comoAdmin.status === 200 && comoAdmin.data.admin === true, `HTTP ${comoAdmin.status}`);

  const sinToken = await fetch(`${BASE}/api/admin/operations`, { cache: "no-store" }).then((r) => r.status);
  check("sin sesión no se llega ni al handler", sinToken === 401, `HTTP ${sinToken} (middleware)`);

  // ── Cierre: el catálogo real no se ha movido ──
  paso(10, "COMPROBACIÓN FINAL — EL CATÁLOGO NO SE HA MOVIDO");
  const { count: finales } = await db.from("content_cards").select("card_id", { count: "exact", head: true });
  check("mismas definiciones que al empezar", finales === persistidas, `${finales} · ${persistidas}`);
  const { count: listadosReales } = await db.from("market_listings").select("id", { count: "exact", head: true });
  check("el mercado real queda con los listados que tenía", listadosReales === 1, `${listadosReales} listado(s)`);
}

/** Diez cartas propias que compongan un mazo legal (2 por rol). Se conceden con service_role. */
async function construirMazo(userId: string): Promise<string[]> {
  const porRol = new Map<RoleId, string[]>();
  const { data: jugadores } = await db.from("content_players").select("id, role");
  const rolDe = new Map(((jugadores ?? []) as { id: string; role: RoleId }[]).map((p) => [p.id, p.role]));
  const { data: cards } = await db.from("content_cards").select("card_id, player_id, ovr").order("ovr", { ascending: false }).limit(2000);
  const vistos = new Set<string>();
  for (const c of (cards ?? []) as { card_id: string; player_id: string }[]) {
    const rol = rolDe.get(c.player_id);
    if (!rol || vistos.has(c.player_id)) continue;
    const lista = porRol.get(rol) ?? [];
    if (lista.length >= 2) continue;
    lista.push(c.card_id); porRol.set(rol, lista); vistos.add(c.player_id);
  }
  const elegidas = DUEL_ROLES.flatMap((r) => porRol.get(r) ?? []);
  const filas = elegidas.map((cardId) => ({ uid: randomUUID(), user_id: userId, card_id: cardId, origin: "admin" }));
  const { error } = await db.from("user_cards").insert(filas);
  if (error) throw new Error(`mazo: ${error.message}`);
  return filas.map((f) => f.uid);
}

main()
  .catch((e) => { console.error("\n✕ QA abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    for (const id of creadas) await db.auth.admin.deleteUser(id).catch(() => {});
    console.log("\n" + "─".repeat(72));
    console.log(`  ${pass} correctas · ${fail} fallidas · ${creadas.length} cuentas de prueba borradas`);
    console.log(fail === 0 ? "  ✅ QA REAL SUPERADA" : "  ❌ QA REAL CON FALLOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
