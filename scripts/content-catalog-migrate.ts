/**
 * MIGRACIÓN GENERADORA DEL CATÁLOGO — `npm run content-catalog:migrate` (Bloque 8.1).
 *
 * Materializa en `content_players` / `content_cards` el catálogo que hoy solo existe como
 * resultado de una función.
 *
 * ────────────────────────── LO QUE ESTE SCRIPT NO ES ──────────────────────────
 *
 * No es un volcado. No hay 772 cartas escritas en ningún sitio, ni un JSON intermedio, ni
 * una lista pegada. Este script ejecuta `cardsForPlayer()` sobre `PLAYERS` —la MISMA
 * función que construye el catálogo del juego— y persiste lo que devuelve. Por eso es
 * reproducible: volver a ejecutarlo sobre una base vacía produce exactamente las mismas
 * filas, y ejecutarlo sobre una base ya migrada no cambia ninguna.
 *
 * La consecuencia importante es la contraria de lo que suele pasar en una migración: aquí
 * NO se puede introducir un error de transcripción, porque no hay transcripción.
 *
 * ────────────────────────── IDEMPOTENCIA ──────────────────────────
 *
 * `upsert` por clave primaria. Un segundo pase no duplica, no reordena y no toca
 * `created_at`. Solo actualiza `updated_at` de las filas cuyo contenido cambió, y la
 * versión del catálogo sube ÚNICAMENTE si la huella global cambió — así un pase inocuo no
 * invalida los catálogos en memoria de los procesos que estén sirviendo.
 *
 * ────────────────────────── LO QUE NO TOCA ──────────────────────────
 *
 * Ni una fila de `user_cards`, `card_mints`, `duel_decks`, `market_listings`,
 * `card_reference` o `duel_matches`. La propiedad, los seriales, los mazos, el mercado y
 * las partidas quedan exactamente donde estaban; `content-catalog:integrity` lo demuestra
 * comparando el antes y el después fila a fila.
 *
 *   --dry-run   calcula y compara, pero no escribe nada.
 *   --prune     borra de `content_cards` las filas que el generador ya no produce
 *               (solo con confirmación explícita; ver §PODA).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PLAYERS } from "../src/data/players";
import { CARDS } from "../src/data/catalog";
import {
  toPlayerRow, toCardRow, cardChecksum, catalogChecksum,
} from "../src/server/catalog/rows";

// ───────────────────────────── entorno ─────────────────────────────
const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const DRY = process.argv.includes("--dry-run");
const PRUNE = process.argv.includes("--prune");
const BATCH = 250;

async function main(): Promise<void> {
  console.log("\n═══ MIGRACIÓN DEL CATÁLOGO A BASE DE DATOS (Bloque 8.1) ═══\n");
  if (DRY) console.log("  MODO SIMULACIÓN — no se escribirá nada.\n");

  // ── 1. Generar. Con la función del juego, no con una copia suya. ──
  /*
   * El índice del `map` NO es decorativo: es el ORDEN DE GENERACIÓN, y el sorteo de sobres
   * elige por posición dentro del pool. Persistirlo es lo que hace que la misma semilla
   * entregue la misma carta leyendo de la base de datos. Ver `content_cards.ordinal`.
   */
  const playerRows = PLAYERS.map(toPlayerRow);
  const cardRows = CARDS.map(toCardRow);
  const expectedChecksum = catalogChecksum(CARDS.map((c) => ({ cardId: c.id, checksum: cardChecksum(c) })));

  console.log(`  generados  : ${playerRows.length} jugadores · ${cardRows.length} cartas`);
  console.log(`  huella     : ${expectedChecksum.slice(0, 16)}…`);

  // Invariante de identidad, comprobado ANTES de escribir. El esquema lo repite con un
  // CHECK, pero fallar aquí da un mensaje útil en vez de un error de restricción.
  const malformed = cardRows.filter((r) => r.card_id !== `${r.player_id}__${r.variant_id}`);
  if (malformed.length > 0) {
    console.error(`\n  ✕ ${malformed.length} cartas con id que no es playerId__variantId. Abortado.`);
    process.exit(1);
  }
  // Un jugador huérfano rompería la FK a mitad de escritura; mejor saberlo antes.
  const knownPlayers = new Set(playerRows.map((p) => p.id));
  const orphanCards = cardRows.filter((r) => !knownPlayers.has(r.player_id));
  if (orphanCards.length > 0) {
    console.error(`\n  ✕ ${orphanCards.length} cartas de jugadores que no están en el roster. Abortado.`);
    process.exit(1);
  }

  // ── 2. Estado actual ──
  const before = await currentState();
  console.log(`  en BD ahora: ${before.players} jugadores · ${before.cards} cartas · versión ${before.version}`);

  /*
   * Solo se comparan las filas del GENERADOR. Una carta `legacy` no la produce el
   * generador por definición, así que aparecer en esta lista no significa que sobre: en
   * 8.1 esta comprobación miraba todas las filas porque todas venían del generador.
   */
  const toDelete = [...before.seedIds].filter((id) => !cardRows.some((r) => r.card_id === id));
  if (toDelete.length > 0) {
    console.log(`\n  ⚠ ${toDelete.length} cartas persistidas que el generador ya NO produce:`);
    for (const id of toDelete.slice(0, 20)) console.log(`      ${id}`);
    if (!PRUNE) {
      console.log("      (no se borran; --prune para hacerlo, y solo si sabes que nadie las posee)");
    }
  }

  if (DRY) {
    console.log(`\n  Simulación: escribiría ${playerRows.length} jugadores y ${cardRows.length} cartas.`);
    console.log(`  Versión ${before.checksum === expectedChecksum ? "SIN cambio (huella idéntica)" : "SUBIRÍA (huella distinta)"}.`);
    return;
  }

  /*
   * BLOQUE 8.2 — un alta requiere versión, y esto no la sabe crear.
   *
   * Desde 0038, `content_cards.definition_version` es una clave ajena contra
   * `content_card_versions`: insertar una carta sin su versión 1 lo rechaza la base de
   * datos. Este migrador re-materializa el catálogo existente; dar de alta una carta NUEVA
   * es una operación con versión, motivo y autoría, y eso es el plano administrativo de
   * 8.3. Se detecta y se dice, en vez de fallar con un error de restricción a mitad.
   */
  const nuevas = cardRows.filter((r) => !before.cardIds.has(r.card_id));
  if (nuevas.length > 0) {
    console.error(`\n  ✕ ${nuevas.length} carta(s) que el generador produce y no están persistidas:`);
    for (const r of nuevas.slice(0, 10)) console.error(`      ${r.card_id}`);
    console.error("    Un alta necesita versión inicial (0038). Eso es el alta versionada de 8.3.");
    process.exit(1);
  }

  // ── 3. Escribir. Jugadores primero: las cartas tienen FK contra ellos. ──
  await upsertAll("content_players", playerRows, "id");
  console.log(`  ✓ content_players: ${playerRows.length} filas`);
  await upsertAll("content_cards", cardRows, "card_id");
  console.log(`  ✓ content_cards:   ${cardRows.length} filas`);

  /*
   * PODA. Solo bajo --prune y solo de cartas que NADIE posee: borrar la definición de una
   * carta que alguien tiene en la mochila es exactamente el daño que este bloque existe
   * para evitar. Con la migración inicial esta rama no se ejecuta (la BD parte vacía).
   */
  if (PRUNE && toDelete.length > 0) {
    const { data: owned } = await db.from("user_cards").select("card_id").in("card_id", toDelete);
    const ownedIds = new Set(((owned ?? []) as { card_id: string }[]).map((r) => r.card_id));
    const safe = toDelete.filter((id) => !ownedIds.has(id));
    if (ownedIds.size > 0) {
      console.log(`  ⚠ ${ownedIds.size} NO se borran: hay usuarios que las poseen.`);
    }
    if (safe.length > 0) {
      const { error } = await db.from("content_cards").delete().in("card_id", safe);
      if (error) throw new Error(`poda: ${error.message}`);
      console.log(`  ✓ podadas ${safe.length} definiciones sin propietario`);
    }
  }

  // ── 4. Publicar la versión ──
  const after = await currentState();
  const changed = after.checksum !== before.checksum || before.cards === 0;
  const version = changed ? before.version + 1 : before.version;
  const { error } = await db.from("content_catalog_version").update({
    version,
    cards_count: after.cards,
    players_count: after.players,
    catalog_checksum: after.checksum,
    updated_at: new Date().toISOString(),
  }).eq("id", true);
  if (error) throw new Error(`versión: ${error.message}`);

  console.log(`\n  ✓ catálogo publicado — versión ${version}${changed ? "" : " (sin cambios; versión intacta)"}`);
  console.log(`    ${after.players} jugadores · ${after.cards} cartas · huella ${after.checksum.slice(0, 16)}…`);

  // ── 5. La comprobación que decide si esto ha ido bien ──
  // Contra la huella de la SEMILLA, no la del catálogo entero: la legacy no la produce el
  // generador y compararla contra él sería pedirle que produjera lo que no produce.
  const ok = after.seedChecksum === expectedChecksum && after.seedCards === cardRows.length;
  console.log(`\n  ${ok ? "✓" : "✕"} lo generado está persistido ${ok ? "IDÉNTICO" : "DISTINTO"}`);
  if (after.cards !== after.seedCards) {
    console.log(`    (+${after.cards - after.seedCards} definición(es) que no vienen del generador: legacy)`);
  }
  if (!ok) {
    console.error(`    esperado ${expectedChecksum}\n    obtenido ${after.seedChecksum}`);
    process.exit(1);
  }
  console.log("\n  Siguiente paso: npm run content-catalog:verify\n");
}

/**
 * Lee de la BD lo que hace falta para decidir si algo cambió.
 *
 * BLOQUE 8.2 — dos huellas, no una, porque el catálogo dejó de ser solo lo que genera el
 * código:
 *
 *   `seedChecksum`    solo las filas `origin='seed-generator'`. Es la que se compara con el
 *                     generador: la garantía «persistido = generado» de 8.1, intacta.
 *   `catalogChecksum` TODAS las filas, incluida la legacy retirada. Es la identidad del
 *                     catálogo publicado, la que usan los procesos para saber si su copia
 *                     en memoria caducó.
 *
 * Confundirlas haría una de dos cosas, las dos malas: o la legacy rompería la comprobación
 * del generador, o quedaría fuera de la huella que detecta caducidad.
 */
async function currentState(): Promise<{
  players: number; cards: number; seedCards: number; version: number;
  checksum: string; seedChecksum: string; cardIds: Set<string>; seedIds: Set<string>;
}> {
  const { count: players } = await db.from("content_players").select("id", { count: "exact", head: true });
  const rows: { card_id: string; checksum: string; origin: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("content_cards").select("card_id, checksum, origin").order("card_id").range(from, from + 999);
    if (error) throw new Error(`lectura: ${error.message}`);
    const page = (data ?? []) as { card_id: string; checksum: string; origin: string }[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const seed = rows.filter((r) => r.origin === "seed-generator");
  const { data: v } = await db.from("content_catalog_version").select("version").eq("id", true).maybeSingle();
  return {
    players: players ?? 0,
    cards: rows.length,
    seedCards: seed.length,
    version: Number((v as { version: number } | null)?.version ?? 0),
    checksum: catalogChecksum(rows.map((r) => ({ cardId: r.card_id, checksum: r.checksum }))),
    seedChecksum: catalogChecksum(seed.map((r) => ({ cardId: r.card_id, checksum: r.checksum }))),
    cardIds: new Set(rows.map((r) => r.card_id)),
    seedIds: new Set(seed.map((r) => r.card_id)),
  };
}

async function upsertAll(table: string, rows: object[], onConflict: string): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await db.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table} [${i}..${i + chunk.length}]: ${error.message}`);
  }
}

main().catch((e) => {
  console.error("\n✕ migración abortada:", e instanceof Error ? e.message : e);
  process.exit(1);
});
