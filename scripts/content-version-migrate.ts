/**
 * MIGRACIÓN DE VERSIONADO — `npm run content-version:migrate` (Bloque 8.2).
 *
 * Tres operaciones, en este orden y por este motivo:
 *
 *   1. VERSIONES GÉNESIS — una versión 1 por cada carta persistida, copiada de la propia
 *      fila de `content_cards`. No se vuelve a ejecutar el generador: 8.1 ya demostró que
 *      esa fila ES lo que el generador produce, y rederivarla aquí sería introducir una
 *      segunda oportunidad de discrepar.
 *
 *   2. LA CARTA LEGACY — `derke__champions-mvp` (§FASE 8). Ver abajo.
 *
 *   3. RETROCARGA DE LAS 53 — `minted_version = 1` para los ejemplares ya existentes.
 *
 * ────────────────────────── POR QUÉ LA RETROCARGA A 1 ES EXACTA ──────────────────────────
 *
 * No es una aproximación cómoda; es un hecho medido. La versión 1 tiene
 * `effective_from = CATALOG_GENERATED_AT` (2026-08-31), y las 53 instancias se obtuvieron
 * entre el 2026-09-02 y el 2026-09-08 — TODAS posteriores. La versión 1 las cubre de
 * verdad. Si alguna fuera anterior, este script lo dice y NO la retrocarga: preferimos un
 * `NULL` honesto («no consta») a un número que finge una historia que nadie registró.
 *
 * ────────────────────────── LA CARTA LEGACY ──────────────────────────
 *
 * `card_mints` guarda un serial acuñado de `derke__champions-mvp`, una carta que el
 * generador actual NO produce: Derke sigue en el roster y `champions-mvp` sigue siendo una
 * variante válida, pero su palmarés ya no incluye ese galardón. Lo que falta no son los
 * datos — es la AUTORIZACIÓN.
 *
 * Así que se materializa con la misma matemática del dominio (`deriveCard` sobre el trío
 * real de Derke y el `statBoost` de la variante), sin inventar ni un número, y se marca:
 *
 *     origin    = 'legacy'    ← no salió del generador de catálogo
 *     lifecycle = 'RETIRED'   ← existe y se resuelve, pero NO puede salir en sobres
 *
 * Eso preserva el significado del serial acuñado sin tocar `card_mints`, sin falsificar el
 * palmarés de Derke y sin que la carta vuelva a la circulación. El sorteo sigue viendo 772
 * cartas exactamente iguales que en 8.1.
 *
 *   --dry-run   calcula y compara, no escribe nada.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PLAYERS } from "../src/data/players";
import { CATALOG_GENERATED_AT, playerCombatBase } from "../src/data/catalog";
import { getVariant } from "../src/domain/cards/variants";
import { deriveCard, DATA_VERSION } from "../src/domain/cards/combat";
import { applyStatBoost } from "../src/domain/cards/ovr";
import { bucketForRank } from "../src/domain/packs/types";
import { cardChecksum, catalogChecksum } from "../src/server/catalog/rows";
import type { CardDef, VariantId } from "../src/domain/cards/types";

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
const BATCH = 250;

/** La carta legacy. Su existencia la justifica el serial acuñado, no un palmarés vigente. */
const LEGACY_CARD_ID = "derke__champions-mvp";

interface CardRow {
  card_id: string; player_id: string; variant_id: string; ovr: number;
  combat: unknown; stats: unknown; stat_boost: number; rarity_rank: number;
  rarity_bucket: string; data_version: string; source: string; generated_at: string;
  checksum: string; definition_version: number; lifecycle: string; ordinal: number;
}

async function main(): Promise<void> {
  console.log("\n═══ VERSIONADO DEL CATÁLOGO (Bloque 8.2) ═══\n");
  if (DRY) console.log("  MODO SIMULACIÓN — no se escribirá nada.\n");

  // ── 0. Estado de partida ──
  const cards = await allCards();
  const { count: yaVersionadas } = await db
    .from("content_card_versions").select("card_id", { count: "exact", head: true });
  console.log(`  definiciones : ${cards.length}`);
  console.log(`  versiones ya : ${yaVersionadas ?? 0}`);

  // ── 1. La carta legacy, ANTES de las versiones (para que tenga la suya) ──
  const legacyExiste = cards.some((c) => c.card_id === LEGACY_CARD_ID);
  if (!legacyExiste) {
    const legacy = buildLegacyCard();
    console.log(`\n  carta legacy : ${LEGACY_CARD_ID}`);
    console.log(`    OVR ${legacy.ovr} · combat ${JSON.stringify(legacy.combat)} · derivada por deriveCard(), sin inventar`);
    const mint = await db.from("card_mints").select("minted").eq("card_id", LEGACY_CARD_ID).maybeSingle();
    console.log(`    justificación: ${(mint.data as { minted: number } | null)?.minted ?? 0} serial(es) acuñados en card_mints`);
    if (!DRY) {
      const rank = getVariant(legacy.variantId).rank;
      const maxOrd = Math.max(...cards.map((c) => c.ordinal));
      /*
       * Por RPC y no con dos `insert`: la definición referencia su versión vigente y la
       * versión referencia la definición, así que las dos escrituras tienen que ocurrir en
       * la MISMA transacción. Por PostgREST serían dos, y la clave ajena rechazaría la
       * primera — con razón.
       */
      const { data: res, error } = await db.rpc("app_content_materialize_legacy", {
        p_def: {
          card_id: legacy.id, player_id: legacy.playerId, variant_id: legacy.variantId,
          // AL FINAL del orden: no desplaza ni una posición del catálogo vigente, así que
          // no puede alterar el sorteo. Y siendo RETIRED, tampoco entra en el pool.
          ordinal: maxOrd + 1,
          ovr: legacy.ovr, stats: legacy.stats, combat: legacy.combat, stat_boost: legacy.statBoost,
          rarity_rank: rank, rarity_bucket: bucketForRank(rank),
          data_version: legacy.dataVersion, source: legacy.source, generated_at: legacy.generatedAt,
          checksum: cardChecksum(legacy), effective_from: CATALOG_GENERATED_AT,
        },
        p_reason:
          "Serial acuñado en card_mints de una carta que el generador ya no produce: el " +
          "palmarés de Derke perdió el galardón champions-mvp. Los datos se derivan con " +
          "deriveCard() sobre sus métricas reales; no se inventa ninguno.",
      });
      if (error) throw new Error(`carta legacy: ${error.message}`);
      void res;
      cards.push({
        card_id: legacy.id, player_id: legacy.playerId, variant_id: legacy.variantId,
        ovr: legacy.ovr, combat: legacy.combat, stats: legacy.stats, stat_boost: legacy.statBoost!,
        rarity_rank: rank, rarity_bucket: bucketForRank(rank), data_version: legacy.dataVersion!,
        source: legacy.source!, generated_at: legacy.generatedAt!, checksum: cardChecksum(legacy),
        definition_version: 1, lifecycle: "RETIRED", ordinal: maxOrd + 1,
      });
      console.log(`    ✓ materializada como origin='legacy' · lifecycle='RETIRED'`);
    }
  } else {
    console.log(`\n  carta legacy : ${LEGACY_CARD_ID} ya materializada`);
  }

  // ── 2. Versiones génesis ──
  const { data: existentes } = await db.from("content_card_versions").select("card_id, version");
  const yaTiene = new Set(((existentes ?? []) as { card_id: string; version: number }[])
    .map((r) => `${r.card_id}#${r.version}`));

  const genesis = cards
    .filter((c) => !yaTiene.has(`${c.card_id}#1`))
    .map((c) => ({
      card_id: c.card_id, version: 1,
      player_id: c.player_id, variant_id: c.variant_id,
      ovr: c.ovr, combat: c.combat, stats: c.stats, stat_boost: c.stat_boost,
      rarity_rank: c.rarity_rank, rarity_bucket: c.rarity_bucket,
      data_version: c.data_version, source: c.source, generated_at: c.generated_at,
      checksum: c.checksum,
      // La marca determinista del catálogo, no `now()`: la versión 1 describe la carta
      // desde que el catálogo se generó, y eso es anterior a cualquier instancia.
      effective_from: CATALOG_GENERATED_AT,
      effective_to: null, created_by: null, reason: null,
    }));

  console.log(`\n  versiones génesis a crear: ${genesis.length}`);
  if (!DRY && genesis.length > 0) {
    for (let i = 0; i < genesis.length; i += BATCH) {
      const { error } = await db.from("content_card_versions").insert(genesis.slice(i, i + BATCH));
      if (error) throw new Error(`versiones [${i}]: ${error.message}`);
    }
    console.log(`    ✓ ${genesis.length} versiones 1 creadas`);
  }

  // ── 3. Retrocarga de las instancias existentes ──
  const { data: instRows } = await db
    .from("user_cards").select("uid, card_id, obtained_at, minted_version");
  const inst = (instRows ?? []) as
    { uid: string; card_id: string; obtained_at: string; minted_version: number | null }[];
  const sinVersion = inst.filter((r) => r.minted_version === null);
  console.log(`\n  instancias           : ${inst.length}`);
  console.log(`  sin versión estampada: ${sinVersion.length}`);

  const genesisFrom = Date.parse(CATALOG_GENERATED_AT);
  const conocidas = new Set(cards.map((c) => c.card_id));
  const seguras: string[] = [];
  const anteriores: string[] = [];
  const fueraDeCatalogo: string[] = [];

  for (const r of sinVersion) {
    if (!conocidas.has(r.card_id)) { fueraDeCatalogo.push(r.uid); continue; }
    // La condición que hace EXACTA la retrocarga: el ejemplar es posterior a la vigencia
    // de la versión 1. Si no lo fuera, no sabríamos bajo qué definición se acuñó.
    if (Date.parse(r.obtained_at) >= genesisFrom) seguras.push(r.uid);
    else anteriores.push(r.uid);
  }

  console.log(`    retrocargables a v1 (obtenidas tras ${CATALOG_GENERATED_AT}): ${seguras.length}`);
  if (anteriores.length > 0) {
    console.log(`    ⚠ ANTERIORES a la versión 1, se dejan en NULL: ${anteriores.length}`);
    console.log(`      No se inventa su versión. Quedan como historia no registrada y la vista`);
    console.log(`      v_instance_version_gaps las muestra.`);
  }
  if (fueraDeCatalogo.length > 0) {
    console.log(`    ⚠ de cartas fuera del catálogo, se dejan en NULL: ${fueraDeCatalogo.length}`);
  }

  if (!DRY && seguras.length > 0) {
    for (let i = 0; i < seguras.length; i += BATCH) {
      const { error } = await db.from("user_cards")
        .update({ minted_version: 1 }).in("uid", seguras.slice(i, i + BATCH));
      if (error) throw new Error(`retrocarga [${i}]: ${error.message}`);
    }
    console.log(`    ✓ ${seguras.length} instancias ancladas a su versión`);
  }

  if (DRY) { console.log("\n  Simulación terminada.\n"); return; }

  // ── 4. Validar la clave ajena que 0038 dejó NOT VALID ──
  //
  // Ahora que TODA definición tiene su versión vigente, la restricción puede recorrer las
  // filas preexistentes y quedar validada del todo. Si algo faltara, esto falla aquí y no
  // en la primera escritura de un jugador.
  const { data: fk, error: fkErr } = await db.rpc("app_content_validate_version_fk");
  if (fkErr) throw new Error(`validar FK: ${fkErr.message}`);
  const fkOk = (fk as { ok: boolean } | null)?.ok === true;
  console.log(`\n  ${fkOk ? "✓" : "✕"} content_cards_current_version_fk ${fkOk ? "VALIDADA" : "SIN VALIDAR"}`);
  if (!fkOk) throw new Error("la clave ajena de versión vigente no ha quedado validada");

  // ── 5. Republicar la identidad del catálogo ──
  //
  // Materializar la carta legacy CAMBIA el catálogo, y `content_catalog_version` es la
  // señal que usan los procesos para saber si su copia en memoria caducó. Dejarla con la
  // huella de 772 cartas mientras la base tiene 773 sería exactamente el desajuste que esa
  // tabla existe para impedir — y lo detectó `content-catalog:verify` antes de este paso.
  const { data: chkRows } = await db.from("content_cards").select("card_id, checksum").order("card_id");
  const chk = catalogChecksum(((chkRows ?? []) as { card_id: string; checksum: string }[])
    .map((r) => ({ cardId: r.card_id, checksum: r.checksum })));
  const { data: prev } = await db.from("content_catalog_version")
    .select("version, catalog_checksum").eq("id", true).maybeSingle();
  const pv = prev as { version: number; catalog_checksum: string } | null;
  if (pv && pv.catalog_checksum !== chk) {
    const { error } = await db.from("content_catalog_version").update({
      version: Number(pv.version) + 1,
      cards_count: (chkRows ?? []).length,
      catalog_checksum: chk,
      updated_at: new Date().toISOString(),
    }).eq("id", true);
    if (error) throw new Error(`republicar catálogo: ${error.message}`);
    console.log(`
  ✓ catálogo republicado — versión ${Number(pv.version) + 1} · ${(chkRows ?? []).length} definiciones`);
  } else {
    console.log(`
  · catálogo sin cambios — versión ${pv?.version}`);
  }

  // ── 6. Resumen ──
  const { count: vers } = await db.from("content_card_versions").select("card_id", { count: "exact", head: true });
  const { count: gaps } = await db.from("v_instance_version_gaps").select("uid", { count: "exact", head: true });
  console.log(`\n  ✓ ${vers} versiones · ${inst.length} instancias · ${gaps} sin historia reconstruible`);
  console.log("\n  Siguiente paso: npm run content-version:verify\n");
}

/** Todas las definiciones persistidas, paginadas. */
async function allCards(): Promise<CardRow[]> {
  const out: CardRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("content_cards").select("*").order("ordinal").range(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as CardRow[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/**
 * Construye la definición legacy con la MISMA matemática del dominio.
 *
 * No hay ni un número escrito a mano: el trío sale de las métricas reales de Derke vía
 * `playerCombatBase`, y el OVR y el combate con bonus salen de `deriveCard` con el
 * `statBoost` de la variante. Es exactamente lo que el generador produciría si el galardón
 * siguiera en su palmarés.
 */
function buildLegacyCard(): CardDef {
  const player = PLAYERS.find((p) => p.id === "derke");
  if (!player) throw new Error("El jugador `derke` no está en el roster: la carta legacy no se puede derivar");
  const base = playerCombatBase(player);
  if (!base.ok) throw new Error(`No hay trío derivable para derke (${base.reason}): no se inventa`);

  const variantId = "champions-mvp" as VariantId;
  const variant = getVariant(variantId);
  const { combat, ovr } = deriveCard(base.combat, variant.statBoost);
  return {
    id: `${player.id}__${variantId}`,
    playerId: player.id,
    variantId,
    stats: applyStatBoost(player.stats, variant.statBoost),
    ovr,
    combat,
    statBoost: variant.statBoost,
    dataVersion: DATA_VERSION,
    source: base.source,
    generatedAt: CATALOG_GENERATED_AT,
  };
}

main().catch((e) => {
  console.error("\n✕ migración de versionado abortada:", e instanceof Error ? e.message : e);
  process.exit(1);
});
