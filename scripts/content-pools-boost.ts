/**
 * POOLS DE SESGO POR EQUIPO — `npm run content-pools:boost` (Fase 20).
 *
 * ══════════════════════════ QUÉ CREA, Y POR QUÉ ASÍ ══════════════════════════
 *
 * Un Team Pack significa **más probabilidad de cartas del equipo**, NO una carta del equipo
 * garantizada. Esa diferencia decide toda la implementación:
 *
 *   · Una GARANTÍA se escribiría con `guarantees` en el `PackDef`, se vería en la ficha del
 *     sobre y cambiaría el sorteo. Aquí no hay ninguna.
 *   · Un pool **`EXPLICIT`** restringiría la pertenencia: el sobre entregaría SOLO cartas del
 *     equipo, que es una garantía disfrazada de pool. Tampoco.
 *   · Un pool **`RULE`** con entradas ponderadas **repondera sin restringir**
 *     (`composeDistribution` solo fija `members` en `EXPLICIT`/`MIXED`). Es lo que se crea
 *     aquí: las cartas del equipo pesan 5 y el resto del pool sigue pesando 1.
 *
 * El motor aplica ese peso por la ÚNICA vía que existe (`pickWeighted`, dentro del bucket ya
 * sorteado). No hay lógica nueva, ni una distribución alternativa, ni un `if` por `packId`: si
 * estos pools se desvincularan, los Team Packs se abrirían como un regional cualquiera.
 *
 * ══════════════════════════ PRIORIDAD ══════════════════════════
 *
 * Cada sobre tiene ya su pool base `pack-<id>` (`content-pools:migrate`, modo `EXPLICIT`, peso
 * 1, prioridad 100) que materializa su pertenencia. El pool de sesgo se vincula con prioridad
 * **50**: en `composeDistribution` gana el de MENOR prioridad, así que el peso 5 se impone al 1
 * del pool base. La pertenencia la sigue aportando el pool base, que es lo correcto — el sesgo
 * no debe poder ensanchar ni estrechar el sobre.
 *
 * ══════════════════════════ EL PESO ESTÁ MEDIDO ══════════════════════════
 *
 * 5, no «un número alto». Medido con el motor real en `scripts/_fase20-calibrate.ts` sobre
 * 4.000 aperturas por equipo: da ≈1 carta del equipo por sobre y P(≥1) entre el 63 % y el 74 %
 * en Heretics, NAVI y G2. Fnatic sale en 2,12 y 94 % porque TIENE 25 cartas en el catálogo
 * frente a 10-16 de los demás: sin ningún sesgo ya daría 1,20 por sobre. El peso es el mismo
 * para los cuatro; lo que cambia es el catálogo.
 *
 *   --dry-run   calcula y enseña, no escribe nada.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PACKS } from "../src/data/packs";
import { CardRegistry } from "../src/collection/registry";
import { buildPool } from "../src/domain/packs/pool";
import { bucketForRank } from "../src/domain/packs/types";
import { getVariant } from "../src/domain/cards/variants";
import { isTeamPackCard } from "../src/data/teamIdentities";
import { withPrinted } from "../src/server/catalog/rows";

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

/** El peso de una carta del equipo. Medido, no elegido a ojo (ver cabecera). */
export const TEAM_BOOST_WEIGHT = 5;

/** Prioridad del pool de sesgo. Menor que la del pool base (100) para que su peso mande. */
const BOOST_PRIORITY = 50;

const boostPoolId = (packId: string): string => `boost-${packId}`;

async function main(): Promise<void> {
  console.log("\n═══ POOLS DE SESGO POR EQUIPO (Fase 20) ═══\n");
  if (DRY) console.log("  MODO SIMULACIÓN — no se escribirá nada.\n");

  const conEquipo = PACKS.filter((p) => p.team);
  if (conEquipo.length === 0) {
    console.log("  No hay sobres con equipo en el catálogo. Nada que hacer.\n");
    return;
  }

  /*
   * El registro se construye desde el CATÁLOGO PERSISTIDO, no desde el código: las entradas de
   * un pool referencian `content_cards`, y solo las PUBLISHED se pueden repartir.
   */
  const { data: cardRows, error } = await db.from("content_cards")
    .select("card_id, player_id, variant_id, ovr, stats, combat, stat_boost, data_version, source, generated_at, ordinal")
    .eq("lifecycle", "PUBLISHED").order("ordinal");
  if (error) throw new Error(`catálogo: ${error.message}`);
  const rows = (cardRows ?? []) as {
    card_id: string; player_id: string; variant_id: string; ovr: number;
    stats: unknown; combat: unknown; stat_boost: number; data_version: string;
    source: string; generated_at: string;
  }[];

  const { data: playerRows } = await db.from("content_players").select("*");
  const players = new Map(((playerRows ?? []) as { id: string }[]).map((p) => [p.id, p]));
  const registry = new CardRegistry(
    // `withPrinted` añade lo impreso (rol, equipo) que no tiene columna: el sesgo sigue al equipo IMPRESO.
    rows.map((r) => withPrinted({
      id: r.card_id, playerId: r.player_id, variantId: r.variant_id as never,
      stats: r.stats as never, ovr: r.ovr, combat: r.combat as never,
      statBoost: r.stat_boost, dataVersion: r.data_version,
      source: r.source as never, generatedAt: r.generated_at,
    })),
    (id) => players.get(id) as never,
  );
  console.log(`  catálogo sorteable: ${rows.length} cartas PUBLISHED · sobres de equipo: ${conEquipo.length}\n`);

  for (const pack of conEquipo) {
    const team = pack.team!;
    /*
     * Las cartas del equipo QUE EL SOBRE PUEDE ENTREGAR. Se interseca con `buildPool` —la
     * misma función del motor— y no con el catálogo entero: un sobre restringido a EMEA no
     * puede recibir sesgo sobre cartas de un jugador que no sorteará nunca, y meterlas como
     * entradas dejaría el pool prometiendo algo inalcanzable.
     */
    const { flat } = buildPool(registry, pack);
    // Catálogo diseñado: cartas con el equipo IMPRESO del sobre (misma regla que la auditoría y la tienda).
    const delEquipo = flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), team));

    const porRareza = new Map<string, number>();
    for (const c of delEquipo) {
      const b = bucketForRank(getVariant(c.variantId).rank);
      porRareza.set(b, (porRareza.get(b) ?? 0) + 1);
    }
    const detalle = [...porRareza.entries()].map(([b, n]) => `${b} ${n}`).join(", ") || "ninguna";

    console.log(`  ${pack.id.padEnd(16)} «${team}»`);
    console.log(`    pool del sobre: ${flat.length} cartas · del equipo: ${delEquipo.length} (${detalle})`);

    if (delEquipo.length === 0) {
      /*
       * Un sesgo sobre cero cartas no es un sesgo: es un pool vacío que además haría que el
       * producto prometiera algo que no puede dar. Se aborta en vez de crear la configuración,
       * porque un Team Pack sin cartas del equipo es un error de catálogo, no un caso límite.
       */
      console.error(`    ✕ «${team}» no tiene ninguna carta elegible en este sobre. Revisa Player.team y restrictRegion.`);
      process.exitCode = 1;
      continue;
    }

    const poolId = boostPoolId(pack.id);
    if (DRY) { console.log(`    → ${poolId} (RULE, peso ${TEAM_BOOST_WEIGHT}, prioridad ${BOOST_PRIORITY})\n`); continue; }

    const up = await db.rpc("app_content_pool_upsert", {
      p_pool: {
        id: poolId,
        name: `Sesgo de ${team}`,
        description:
          `Fase 20: repondera las cartas de ${team} a peso ${TEAM_BOOST_WEIGHT} en ${pack.id}. `
          + "Modo RULE: NO restringe la pertenencia — el sobre sigue pudiendo entregar cualquier "
          + "carta de su región. No es una garantía.",
        // RULE es la decisión central de este script. Ver la cabecera.
        mode: "RULE",
        rules: {},
        event_id: pack.eventId ?? null,
        season_id: pack.season ?? null,
      },
      p_reason: `Fase 20: sesgo de equipo para ${pack.id} (peso medido ${TEAM_BOOST_WEIGHT})`,
      p_actor: null,
    });
    if (up.error) throw new Error(`pool ${poolId}: ${up.error.message}`);

    const entries = delEquipo.map((c) => ({ card_id: c.id, weight: TEAM_BOOST_WEIGHT, mode: "INCLUDE" }));
    const se = await db.rpc("app_content_pool_set_entries", {
      p_pool_id: poolId, p_entries: entries,
      p_reason: `Fase 20: ${entries.length} cartas de ${team} a peso ${TEAM_BOOST_WEIGHT}`,
      p_actor: null,
    });
    if (se.error) throw new Error(`entradas ${poolId}: ${se.error.message}`);

    const bind = await db.rpc("app_content_pack_bind", {
      p_pack_id: pack.id, p_pool_id: poolId, p_priority: BOOST_PRIORITY, p_action: "bind", p_actor: null,
    });
    if (bind.error) throw new Error(`vínculo ${pack.id}: ${bind.error.message}`);

    /*
     * Solo se publica si no está ya ACTIVE: la RPC rechaza `ACTIVE → ACTIVE` (es una máquina
     * de estados), así que llamar siempre haría que este script no se pudiera repetir.
     */
    const { data: actual } = await db.from("content_pools")
      .select("lifecycle").eq("id", poolId).maybeSingle();
    if ((actual as { lifecycle: string } | null)?.lifecycle !== "ACTIVE") {
      const pub = await db.rpc("app_content_pool_publish", {
        p_pool_id: poolId, p_state: "ACTIVE", p_actor: null,
      });
      if (pub.error) throw new Error(`publicar ${poolId}: ${pub.error.message}`);
    }

    console.log(`    ✓ ${poolId} — ${entries.length} entradas a peso ${TEAM_BOOST_WEIGHT}, prioridad ${BOOST_PRIORITY}\n`);
  }

  if (DRY) { console.log("  Simulación terminada.\n"); return; }

  const { data: ver } = await db.from("content_distribution_version").select("*").eq("id", true).maybeSingle();
  const v = ver as { version: number; pools_count: number; entries_count: number } | null;
  console.log(`  ✓ distribución publicada — versión ${v?.version} · ${v?.pools_count} pools activos · ${v?.entries_count} entradas`);
  console.log("\n  Siguiente paso: npm run content-pools:verify\n");
}

main().catch((e) => {
  console.error("\n✕ pools de sesgo abortados:", e instanceof Error ? e.message : e);
  process.exit(1);
});
