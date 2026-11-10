/**
 * INSTRUMENTO DE MEDIDA — CATÁLOGO REAL DE TEAM PACKS (Fase 20.2).
 *
 *   npx tsx scripts/_fase20-2-audit.ts
 *
 * Prefijado con `_` y FUERA de CI: es el instrumento de la fase, no un gate permanente.
 *
 * Dos partes:
 *
 *   1. CÓDIGO — la tabla de los 24 equipos desde `PLAYERS`, `CARDS`, `PACKS` y el manifiesto de
 *      artwork, con los bloqueos DERIVADOS de los datos y comparados con los declarados en
 *      `data/teamPackCatalog.ts`. No necesita nada levantado.
 *   2. BASE DE DATOS — los recuentos de §13 (cartas, versiones, ejemplares, mints, pools,
 *      entradas, vínculos, listados) y el estado real de los pools de equipo. Si Supabase no
 *      responde, lo dice y no inventa cifras.
 *
 * No escribe nada en ningún sitio.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  TEAM_PACK_AUDIT, derivedBlockers, deriveStatus, rosterDiscrepancies, cardsForTeamValue, proposedTeamPack,
} from "../src/data/teamPackCatalog";
import { PLAYERS } from "../src/data/players";
import { PACKS, getPack } from "../src/data/packs";
import { PACK_ART_AVAILABLE } from "../src/data/packArtwork";
import { CardRegistry } from "../src/collection/registry";
import { buildPool } from "../src/domain/packs/pool";
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

const registry = new CardRegistry();
let incoherencias = 0;

console.log("\n═══ FASE 20.2 · TEAM PACK CATALOG AUDIT ═══\n");
console.log(`  catálogo: ${PLAYERS.length} jugadores · ${registry.cards.length} cartas · ${PACKS.length} sobres (${PACKS.filter((p) => p.team).length} de equipo)\n`);

console.log("  1 · CÓDIGO\n");
for (const e of TEAM_PACK_AUDIT) {
  const ids = e.identifiers.map((i) => `${i}: ${PLAYERS.filter((p) => p.team === i).length}j/${cardsForTeamValue(i)}c`).join(" · ");
  const pack = getPack(e.packId) ?? proposedTeamPack(e);
  let elig = "—";
  if (pack && e.packTeam) {
    const flat = buildPool(registry, pack).flat;
    const suyas = flat.filter((c) => registry.player(c.playerId)?.team === e.packTeam);
    const b: Record<string, number> = {};
    for (const c of suyas) { const k = bucketForRank(getVariant(c.variantId).rank); b[k] = (b[k] ?? 0) + 1; }
    elig = `${suyas.length}/${flat.length} [${Object.entries(b).map(([k, n]) => `${k} ${n}`).join(", ")}]`;
  }
  const derivados = derivedBlockers(e);
  const declarados = e.blockers.filter((b) => b !== "IDENTITY_UNPROVEN");
  const coincide = [...derivados].sort().join() === [...declarados].sort().join()
    && e.status === deriveStatus(e.blockers, PACKS.some((p) => p.id === e.packId));
  if (!coincide) incoherencias++;

  console.log(`  ${coincide ? "✓" : "✗"} ${e.requested.padEnd(18)} ${e.region.padEnd(9)} ${e.status.padEnd(8)} ${e.packId}`);
  console.log(`      identificadores   ${ids}`);
  console.log(`      packTeam          ${e.packTeam ?? "— (decisión pendiente)"} · elegibles del equipo ${elig}`);
  console.log(`      producto ${PACKS.some((p) => p.id === e.packId) ? "sí" : "no"} · artwork ${PACK_ART_AVAILABLE.has(e.packId) ? "sí" : "no"} · bloqueos ${e.blockers.join(", ") || "ninguno"}`);
  if (!coincide) console.log(`      ✗ derivados: ${derivados.join(", ") || "ninguno"}`);
}

console.log("\n  DISCREPANCIAS SEMILLA ↔ VLR 2026 (jugadores con cartas)\n");
for (const d of rosterDiscrepancies()) {
  console.log(`    ${d.playerId.padEnd(10)} catálogo «${d.catalogTeam}» · VLR «${d.vlrTeam}» · ${d.cards} cartas`);
}

const recuento = { READY: 0, PARTIAL: 0, BLOCKED: 0 } as Record<string, number>;
for (const e of TEAM_PACK_AUDIT) recuento[e.status]++;
console.log(`\n  READY ${recuento.READY} · PARTIAL ${recuento.PARTIAL} · BLOCKED ${recuento.BLOCKED} · incoherencias declarado/medido: ${incoherencias}\n`);

async function baseDeDatos(): Promise<void> {
  console.log("  2 · BASE DE DATOS\n");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log("    ✗ sin credenciales en .env.local: no se mide\n"); return; }

  try {
    const r = await fetch(`${url}/rest/v1/`, { signal: AbortSignal.timeout(4000) });
    void r;
  } catch (err) {
    console.log(`    ✗ Supabase no responde en ${url} (${err instanceof Error ? err.cause ?? err.message : err}).`);
    console.log("      No se da ninguna cifra de la base: §13, pools y vínculos quedan SIN MEDIR.\n");
    return;
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const contar = async (tabla: string, filtro?: (q: any) => any): Promise<string> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = db.from(tabla).select("*", { count: "exact", head: true });
    if (filtro) q = filtro(q);
    const { count, error } = await q;
    return error ? `error: ${error.message}` : String(count);
  };

  for (const t of ["content_cards", "content_card_versions", "content_players", "user_cards", "card_mints",
    "content_pools", "content_pool_entries", "content_pack_pools", "market_listings"]) {
    console.log(`    ${t.padEnd(24)} ${await contar(t)}`);
  }

  console.log("\n    POOLS Y VÍNCULOS DE LOS SOBRES DE EQUIPO\n");
  for (const p of PACKS.filter((x) => x.team)) {
    const { data: pools } = await db.from("content_pools").select("id, mode, lifecycle, revision")
      .in("id", [`pack-${p.id}`, `boost-${p.id}`]);
    const { data: links } = await db.from("content_pack_pools").select("pool_id, priority, enabled").eq("pack_id", p.id);
    const entradas = await contar("content_pool_entries", (q) => q.eq("pool_id", `boost-${p.id}`));
    console.log(`    ${p.id.padEnd(16)} pools ${JSON.stringify(pools ?? [])}`);
    console.log(`    ${"".padEnd(16)} vínculos ${JSON.stringify(links ?? [])} · entradas del sesgo ${entradas}`);
  }

  console.log("\n    IMPACTO DE UNIFICAR Gen.G / GEN\n");
  const { data: jug } = await db.from("content_players").select("id, team, team_tag").in("team", ["Gen.G", "GEN"]);
  console.log(`    content_players: ${JSON.stringify(jug ?? [])}`);
  for (const team of ["Gen.G", "GEN"]) {
    const ids = PLAYERS.filter((p) => p.team === team).map((p) => p.id);
    const ors = ids.map((id) => `card_id.like.${id}__*`).join(",");
    console.log(`    «${team}» user_cards ${await contar("user_cards", (q) => q.or(ors))} · card_mints ${await contar("card_mints", (q) => q.or(ors))}`);
  }
  console.log("");
}

baseDeDatos().then(() => { if (incoherencias > 0) process.exitCode = 1; });
