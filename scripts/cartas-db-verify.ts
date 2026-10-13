/**
 * VERIFICACIÓN DEL REEMPLAZO DEL CATÁLOGO — SOLO LECTURA (ni un insert, update, delete ni RPC de escritura).
 *
 *   npx tsx scripts/cartas-db-verify.ts
 *
 * Carga el catálogo con el MISMO camino que el servidor (`serverCatalog`, que reconstruye cada fila con
 * `fromCardRow` + `withPrinted`) y lo compara con el del código (`CARDS`, del manifiesto):
 *   · mismas cartas, mismos campos de juego (OVR, rol impreso, combate, stats impresas, imagen);
 *   · huella por carta y del catálogo idénticas a las publicadas;
 *   · pertenencia de cada pool = la que deduce `buildPool` (migrate/boost);
 *   · cada carta tiene su derivado web en `public/cards/` y cero referencias a cartas antiguas.
 * Existe porque `content-*-verify` ESCRIBEN (crean pools, usuarios, versiones) y no se deben correr
 * contra la BD viva.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CARDS } from "../src/data/catalog";
import { PACKS } from "../src/data/packs";
import { CardRegistry } from "../src/collection/registry";
import { buildPool } from "../src/domain/packs/pool";
import { cardChecksum, catalogChecksum } from "../src/server/catalog/rows";
import { serverCatalog } from "../src/server/catalog";
import { isTeamPackCard } from "../src/data/teamIdentities";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`  ${cond ? "✓" : "✕"} ${msg}`); if (!cond) fails++; };

async function count(table: string): Promise<number> {
  const { count: n, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
}

async function main() {
  console.log("\n═══ VERIFICACIÓN DEL CATÁLOGO REEMPLAZADO (solo lectura) ═══\n");
  const cat = await serverCatalog(db);
  ok(cat.source === "db", `el servidor sirve el catálogo de la BD (source=${cat.source}, versión ${cat.version})`);
  ok(cat.cards.length === CARDS.length, `cartas: BD ${cat.cards.length} = código ${CARDS.length}`);

  const byId = new Map(cat.cards.map((c) => [c.id, c]));
  // jsonb no conserva el orden de las claves: se compara valor a valor, con las claves ordenadas.
  const canon = (o: unknown): string => JSON.stringify(o, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
  let diff = 0; const muestras: string[] = [];
  for (const c of CARDS) {
    const s = byId.get(c.id);
    const same = !!s && s.ovr === c.ovr && s.role === c.role && s.image === c.image && s.variantId === c.variantId
      && canon(s.combat) === canon(c.combat) && canon(s.stats) === canon(c.stats) && canon(s.printed) === canon(c.printed)
      && cardChecksum(s) === cardChecksum(c);
    if (!same) { diff++; if (muestras.length < 5) muestras.push(c.id); }
  }
  ok(diff === 0, `cada carta del servidor = la del código (OVR, rol, combate, impresas, imagen, huella)${diff ? ` — ${diff} distintas: ${muestras.join(", ")}` : ""}`);
  const expected = catalogChecksum(CARDS.map((c) => ({ cardId: c.id, checksum: cardChecksum(c) })));
  const { data: ver } = await db.from("content_catalog_version").select("version, catalog_checksum, cards_count").eq("id", true).single();
  ok(ver?.catalog_checksum === expected, `huella publicada = huella del código (${expected.slice(0, 16)}…)`);
  ok(cat.checksum === expected, "huella del catálogo servido = huella del código");

  // Pools: pertenencia persistida = la deducida sobre el catálogo nuevo.
  const registry = new CardRegistry(CARDS);
  // PostgREST corta en 1.000 filas por petición: se pagina hasta agotar.
  const entries: { pool_id: string; card_id: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("content_pool_entries").select("pool_id, card_id").order("pool_id").order("card_id").range(from, from + 999);
    if (error) throw new Error(`content_pool_entries: ${error.message}`);
    entries.push(...((data ?? []) as { pool_id: string; card_id: string }[]));
    if (!data || data.length < 1000) break;
  }
  ok(entries.length === await count("content_pool_entries"), `entradas leídas: ${entries.length}`);
  const persisted = new Map<string, Set<string>>();
  for (const e of entries) {
    if (!persisted.has(e.pool_id)) persisted.set(e.pool_id, new Set());
    persisted.get(e.pool_id)!.add(e.card_id);
  }
  let poolDiff = 0;
  for (const pack of PACKS) {
    const flat = buildPool(registry, pack).flat;
    const want = new Set(flat.map((c) => c.id));
    const got = persisted.get(`pack-${pack.id}`) ?? new Set();
    if (want.size !== got.size || [...want].some((id) => !got.has(id))) { poolDiff++; console.log(`    pack-${pack.id}: ${got.size} vs ${want.size}`); }
    if (pack.team) {
      const del = new Set(flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), pack.team)).map((c) => c.id));
      const gotB = persisted.get(`boost-${pack.id}`) ?? new Set();
      if (del.size !== gotB.size || [...del].some((id) => !gotB.has(id))) { poolDiff++; console.log(`    boost-${pack.id}: ${gotB.size} vs ${del.size}`); }
    }
  }
  ok(poolDiff === 0, `pertenencia de los ${persisted.size} pools = la deducida por buildPool`);
  const known = new Set(CARDS.map((c) => c.id));
  ok(entries.every((e) => known.has(e.card_id)), "ninguna entrada de pool apunta a una carta que no esté en el catálogo nuevo");

  // Instancias y referencias: ninguna apunta a una carta que no esté en el catálogo nuevo. (Justo tras el
  // reemplazo todas eran 0; después los jugadores abren sobres de verdad, así que se comprueba la integridad.)
  for (const t of ["user_cards", "card_mints", "card_reference", "market_listings", "user_card_favorites"]) {
    const ids: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(t).select("card_id").range(from, from + 999);
      if (error) throw new Error(`${t}: ${error.message}`);
      ids.push(...((data ?? []) as { card_id: string }[]).map((r) => r.card_id));
      if (!data || data.length < 1000) break;
    }
    const rotas = ids.filter((id) => !known.has(id));
    ok(rotas.length === 0, `${t}: ${ids.length} filas, ${rotas.length} a cartas fuera del catálogo`);
  }
  const { data: uc } = await db.from("user_cards").select("uid").range(0, 99_999);
  const uids = new Set(((uc ?? []) as { uid: string }[]).map((r) => r.uid));
  const { data: decks } = await db.from("duel_decks").select("id, card_uids");
  const huerfanas = ((decks ?? []) as { card_uids: string[] }[]).flatMap((d) => d.card_uids).filter((u) => !uids.has(u));
  ok(huerfanas.length === 0, `duel_decks: ${(decks ?? []).length} mazos, ${huerfanas.length} cartas que no son instancias reales`);
  const { data: orphans } = await db.from("v_content_card_orphans").select("card_id").limit(5);
  ok((orphans ?? []).length === 0, "v_content_card_orphans vacía");
  const { data: showcases } = await db.from("player_profile_customization").select("showcase_card_uids");
  ok(((showcases ?? []) as { showcase_card_uids: string[] }[]).every((r) => r.showcase_card_uids.every((u) => uids.has(u))), "vitrinas: solo instancias reales");

  // Assets.
  const missing = CARDS.filter((c) => !c.image || !existsSync(join(ROOT, "public", c.image)));
  ok(missing.length === 0, `derivado web para las ${CARDS.length} cartas${missing.length ? ` — faltan ${missing.length}` : ""}`);

  console.log(`\n  ${fails === 0 ? "✓ TODO CORRECTO" : `✕ ${fails} comprobaciones fallidas`}\n`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error("✕", e instanceof Error ? e.message : e); process.exit(1); });
