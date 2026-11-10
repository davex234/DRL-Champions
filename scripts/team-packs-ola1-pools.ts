/**
 * OLA 1 — POOLS DE LOS 5 TEAM PACKS NUEVOS (Fase 20.5). Genera el SQL que crea, SOLO para los 5
 * packs de la Ola 1, su pool base (`pack-<id>`, EXPLICIT, peso 1, prioridad 100) y su pool de
 * sesgo (`boost-<id>`, RULE, peso medido, prioridad 50), con las MISMAS RPC y convenciones que
 * `content-pools:migrate` + `content-pools:boost`. NO toca ningún pool existente.
 *
 *   npx tsx scripts/team-packs-ola1-pools.ts            # imprime el SQL (no ejecuta nada)
 *   npx tsx scripts/team-packs-ola1-pools.ts --report   # solo el recuento por pack
 *
 * El SQL se aplica aparte contra la VPS (psql). Las entradas se calculan con el motor real
 * (`buildPool`) sobre el catálogo de código, que la Fase 20.2 verificó idéntico a las cartas
 * PUBLISHED de la base. Un paso de verificación posterior confirma en la BD que cada entrada es
 * PUBLISHED y del equipo correcto.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPack } from "../src/data/packs";
import { CardRegistry } from "../src/collection/registry";
import { buildPool } from "../src/domain/packs/pool";
import { isTeamPackCard } from "../src/data/teamIdentities";

// El peso medido, leído del script de sesgo existente (misma fuente que Fase 20), sin importar el
// módulo —que se auto-ejecuta y tocaría la BD—.
const TEAM_BOOST_WEIGHT = Number(
  readFileSync(join(process.cwd(), "scripts", "content-pools-boost.ts"), "utf8")
    .match(/TEAM_BOOST_WEIGHT\s*=\s*(\d+)/)?.[1],
);
if (!(TEAM_BOOST_WEIGHT > 1)) { console.error("✕ no se pudo leer TEAM_BOOST_WEIGHT"); process.exit(1); }

// Los packs a los que crear pools. Por defecto la Ola 1; se pueden pasar ids por CLI para otras
// olas: `npx tsx scripts/team-packs-ola1-pools.ts team-tyl team-karmine ...`.
const OLA1 = ["team-loud", "team-blg", "team-te", "team-jdg", "team-liquid"];
const cliIds = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const TARGET = cliIds.length ? cliIds : OLA1;
const BASE_PRIORITY = 100;
const BOOST_PRIORITY = 50;
const registry = new CardRegistry();
const REPORT = process.argv.includes("--report");

const sqlStr = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const jsonb = (o: unknown): string => `${sqlStr(JSON.stringify(o))}::jsonb`;

const lines: string[] = [];
lines.push(`-- Fase 20.5 — pools de ${TARGET.length} Team Packs. Idempotente. No toca pools existentes.`);
lines.push("begin;");

for (const packId of TARGET) {
  const pack = getPack(packId);
  if (!pack || !pack.team) { console.error(`✕ ${packId} no existe o no tiene team`); process.exit(1); }
  if (pack.lifecycle !== "DRAFT") { console.error(`✕ ${packId} no es DRAFT`); process.exit(1); }

  const flat = buildPool(registry, pack).flat;
  const delEquipo = flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), pack.team));
  if (delEquipo.length === 0) { console.error(`✕ ${packId}: 0 cartas de «${pack.team}»`); process.exit(1); }
  // Salvaguarda: ninguna entrada de sesgo puede ser de otro equipo.
  const ajenas = delEquipo.filter((c) => !isTeamPackCard(c, registry.player(c.playerId), pack.team));
  if (ajenas.length) { console.error(`✕ ${packId}: entradas de otro equipo`); process.exit(1); }

  if (REPORT) {
    console.log(`${packId.padEnd(14)} team=${(pack.team ?? "").padEnd(5)} region=${(pack.restrictRegion ?? "").padEnd(9)} base=${flat.length} boost=${delEquipo.length} @${TEAM_BOOST_WEIGHT}`);
    continue;
  }

  const basePool = `pack-${packId}`;
  const boostPool = `boost-${packId}`;
  const baseEntries = flat.map((c) => ({ card_id: c.id, weight: 1, mode: "INCLUDE" }));
  const boostEntries = delEquipo.map((c) => ({ card_id: c.id, weight: TEAM_BOOST_WEIGHT, mode: "INCLUDE" }));

  lines.push(`\n-- ${packId} · base ${basePool} (${flat.length}) + sesgo ${boostPool} (${delEquipo.length} @${TEAM_BOOST_WEIGHT})`);

  // ── Pool base (EXPLICIT, peso 1, prioridad 100) ──
  lines.push(`select public.app_content_pool_upsert(${jsonb({
    id: basePool, name: `Pool de ${pack.name}`,
    description: `Fase 20.5: pertenencia del sobre ${packId} (${flat.length} cartas, peso 1). EXPLICIT.`,
    mode: "EXPLICIT", rules: {}, event_id: pack.eventId ?? null, season_id: pack.season ?? null,
  })}, ${sqlStr(`Fase 20.5: pool base ${packId}`)}, null::uuid);`);
  lines.push(`select public.app_content_pool_set_entries(${sqlStr(basePool)}, ${jsonb(baseEntries)}, ${sqlStr(`Fase 20.5: ${flat.length} cartas`)}, null::uuid);`);
  lines.push(`select public.app_content_pack_bind(${sqlStr(packId)}, ${sqlStr(basePool)}, ${BASE_PRIORITY}, 'bind', null::uuid);`);
  lines.push(`select public.app_content_pool_publish(${sqlStr(basePool)}, 'ACTIVE', null::uuid);`);

  // ── Pool de sesgo (RULE, peso medido, prioridad 50) ──
  lines.push(`select public.app_content_pool_upsert(${jsonb({
    id: boostPool, name: `Sesgo de ${pack.team}`,
    description: `Fase 20.5: repondera las cartas de ${pack.team} a peso ${TEAM_BOOST_WEIGHT} en ${packId}. RULE: NO restringe la pertenencia, solo reordena. No es una garantía.`,
    mode: "RULE", rules: {}, event_id: pack.eventId ?? null, season_id: pack.season ?? null,
  })}, ${sqlStr(`Fase 20.5: sesgo ${packId} (peso ${TEAM_BOOST_WEIGHT})`)}, null::uuid);`);
  lines.push(`select public.app_content_pool_set_entries(${sqlStr(boostPool)}, ${jsonb(boostEntries)}, ${sqlStr(`Fase 20.5: ${delEquipo.length} cartas de ${pack.team} a peso ${TEAM_BOOST_WEIGHT}`)}, null::uuid);`);
  lines.push(`select public.app_content_pack_bind(${sqlStr(packId)}, ${sqlStr(boostPool)}, ${BOOST_PRIORITY}, 'bind', null::uuid);`);
  lines.push(`select public.app_content_pool_publish(${sqlStr(boostPool)}, 'ACTIVE', null::uuid);`);
}

if (!REPORT) {
  lines.push("\ncommit;");
  console.log(lines.join("\n"));
}
