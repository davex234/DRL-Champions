/**
 * MIGRACIÓN DE LA DISTRIBUCIÓN — `npm run content-pools:migrate` (Bloque 8.3).
 *
 * Materializa la configuración de pool que hoy está IMPLÍCITA en `PackDef`.
 *
 * ────────────────────────── QUÉ SIGNIFICA «MIGRAR» AQUÍ ──────────────────────────
 *
 * Hoy la pertenencia carta↔sobre no está declarada en ningún sitio: se DEDUCE evaluando
 * `isEligible(registry, pack, card)` contra las 772 cartas. Eso es H-4 de la auditoría —
 * «¿en qué sobres sale esta carta?» no se puede consultar, solo recalcular.
 *
 * Este script convierte esa deducción en filas: un pool por sobre, con la lista EXPLÍCITA de
 * las cartas que hoy son elegibles y **peso 1** para todas.
 *
 * Peso 1 no es un valor de relleno: es el valor que hace que la fórmula nueva
 * `P(carta|bucket) = peso / Σpesos` sea, aritmética a aritmética, la uniforme actual
 * `1/|candidatos|`. La demostración está en `src/domain/packs/weighted.ts` y la comprueba
 * `content-pools:verify` abriendo sobres reales. **La migración no puede cambiar lo que
 * sale, y esa es su única condición de éxito.**
 *
 * ────────────────────────── POR QUÉ EXPLÍCITO Y NO POR REGLAS ──────────────────────────
 *
 * Un pool `RULE` que repitiera `restrictGroups`/`restrictRegion` sería más corto, pero
 * dejaría la pertenencia otra vez deducida —ahora en dos sitios en vez de uno— y H-4
 * seguiría abierto. Con entradas explícitas, la pregunta se responde con un `select`.
 *
 * El coste es 6.464 filas para los 12 sobres. Es un dato de configuración, no de tráfico:
 * no crece con los jugadores ni con las aperturas.
 *
 *   --dry-run   calcula y compara, no escribe nada.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PACKS } from "../src/data/packs";
import { CardRegistry } from "../src/collection/registry";
import { buildPool } from "../src/domain/packs/pool";
import { DEFAULT_WEIGHT } from "../src/domain/packs/weighted";

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

const poolIdFor = (packId: string): string => `pack-${packId}`;

async function main(): Promise<void> {
  console.log("\n═══ MIGRACIÓN DE LA DISTRIBUCIÓN (Bloque 8.3) ═══\n");
  if (DRY) console.log("  MODO SIMULACIÓN — no se escribirá nada.\n");

  /*
   * El registro se construye desde el CATÁLOGO PERSISTIDO, no desde el código: la
   * pertenencia que se persiste tiene que ser la del catálogo que el servidor sirve de
   * verdad, incluida la exclusión de las cartas retiradas.
   */
  const { data: cardRows, error } = await db.from("content_cards")
    .select("card_id, player_id, variant_id, ovr, stats, combat, stat_boost, data_version, source, generated_at, lifecycle, ordinal")
    .eq("lifecycle", "PUBLISHED").order("ordinal");
  if (error) throw new Error(`catálogo: ${error.message}`);
  const rows = (cardRows ?? []) as {
    card_id: string; player_id: string; variant_id: string; ovr: number;
    stats: unknown; combat: unknown; stat_boost: number; data_version: string;
    source: string; generated_at: string; ordinal: number;
  }[];
  console.log(`  catálogo sorteable: ${rows.length} cartas PUBLISHED`);

  const { data: playerRows } = await db.from("content_players").select("*");
  const players = new Map(((playerRows ?? []) as { id: string }[]).map((p) => [p.id, p]));
  const registry = new CardRegistry(
    rows.map((r) => ({
      id: r.card_id, playerId: r.player_id, variantId: r.variant_id as never,
      stats: r.stats as never, ovr: r.ovr, combat: r.combat as never,
      statBoost: r.stat_boost, dataVersion: r.data_version,
      source: r.source as never, generatedAt: r.generated_at,
    })),
    (id) => players.get(id) as never,
  );

  let totalEntradas = 0;
  const resumen: { pack: string; pool: string; cartas: number }[] = [];

  for (const pack of PACKS) {
    // La MISMA función que usa el motor. No se reimplementa la elegibilidad: se ejecuta.
    const { flat } = buildPool(registry, pack);
    const poolId = poolIdFor(pack.id);
    resumen.push({ pack: pack.id, pool: poolId, cartas: flat.length });
    totalEntradas += flat.length;

    if (DRY) continue;

    const up = await db.rpc("app_content_pool_upsert", {
      p_pool: {
        id: poolId,
        name: `Pool de ${pack.name}`,
        description: `Migrado de PackDef.${pack.id} (bloque 8.3). Pertenencia explícita, peso ${DEFAULT_WEIGHT}.`,
        // EXPLICIT: la pertenencia son las entradas. Ver §«por qué explícito».
        mode: "EXPLICIT",
        rules: {},
        event_id: pack.eventId ?? null,
        season_id: pack.season ?? null,
      },
      p_reason: "Migración 8.3: materializar la elegibilidad implícita de PackDef",
      p_actor: null,
    });
    if (up.error) throw new Error(`pool ${poolId}: ${up.error.message}`);

    const entries = flat.map((c) => ({ card_id: c.id, weight: DEFAULT_WEIGHT, mode: "INCLUDE" }));
    const se = await db.rpc("app_content_pool_set_entries", {
      p_pool_id: poolId, p_entries: entries,
      p_reason: "Migración 8.3: pertenencia idéntica a la que deduce isEligible()",
      p_actor: null,
    });
    if (se.error) throw new Error(`entradas ${poolId}: ${se.error.message}`);

    const bind = await db.rpc("app_content_pack_bind", {
      p_pack_id: pack.id, p_pool_id: poolId, p_priority: 100, p_action: "bind", p_actor: null,
    });
    if (bind.error) throw new Error(`vínculo ${pack.id}: ${bind.error.message}`);

    /*
     * PUBLICAR SOLO SI NO ESTÁ YA PUBLICADO (Fase 20).
     *
     * `app_content_pool_publish` rechaza `ACTIVE → ACTIVE` a propósito: es una máquina de
     * estados y una transición a sí misma no significa nada. Pero este script llamaba a
     * publicar SIEMPRE, así que en cuanto existía un solo pool activo, volver a ejecutarlo
     * abortaba en el primero — y con él la única vía de provisionar el pool de un sobre NUEVO.
     *
     * Se arregla aquí y no relajando la guarda de la base de datos: el invariante del
     * lifecycle es correcto; lo que no era idempotente era la migración.
     */
    const { data: actual } = await db.from("content_pools")
      .select("lifecycle").eq("id", poolId).maybeSingle();
    if ((actual as { lifecycle: string } | null)?.lifecycle !== "ACTIVE") {
      const pub = await db.rpc("app_content_pool_publish", {
        p_pool_id: poolId, p_state: "ACTIVE", p_actor: null,
      });
      if (pub.error) throw new Error(`publicar ${poolId}: ${pub.error.message}`);
    }
  }

  console.log("");
  for (const r of resumen) {
    console.log(`  ${r.pack.padEnd(12)} → ${r.pool.padEnd(20)} ${String(r.cartas).padStart(4)} cartas`);
  }
  console.log(`\n  ${PACKS.length} pools · ${totalEntradas} entradas · peso ${DEFAULT_WEIGHT} en todas`);

  if (DRY) { console.log("\n  Simulación terminada.\n"); return; }

  const { data: ver } = await db.from("content_distribution_version").select("*").eq("id", true).maybeSingle();
  const v = ver as { version: number; pools_count: number; entries_count: number } | null;
  console.log(`\n  ✓ distribución publicada — versión ${v?.version} · ${v?.pools_count} pools activos · ${v?.entries_count} entradas`);

  // Comprobación inmediata: lo persistido tiene que coincidir con lo que deduce el motor.
  let diff = 0;
  for (const pack of PACKS) {
    const esperado = new Set(buildPool(registry, pack).flat.map((c) => c.id));
    const { data: got } = await db.from("content_pool_entries")
      .select("card_id").eq("pool_id", poolIdFor(pack.id)).eq("mode", "INCLUDE");
    const real = new Set(((got ?? []) as { card_id: string }[]).map((r) => r.card_id));
    if (real.size !== esperado.size || [...esperado].some((id) => !real.has(id))) diff++;
  }
  console.log(`  ${diff === 0 ? "✓" : "✕"} pertenencia persistida ${diff === 0 ? "IDÉNTICA" : "DISTINTA"} a la deducida (${diff} sobres divergen)`);
  if (diff > 0) process.exit(1);

  console.log("\n  Siguiente paso: npm run content-pools:verify\n");
}

main().catch((e) => {
  console.error("\n✕ migración de distribución abortada:", e instanceof Error ? e.message : e);
  process.exit(1);
});
