/**
 * POST-REEMPLAZO · PERTENENCIA DE POOLS AL CATÁLOGO DISEÑADO — genera UN fichero SQL de UNA transacción.
 *
 *   npx tsx scripts/cartas-db-pools.ts --out <fichero.sql> [--commit]
 *
 * Lee la BD (solo SELECT, por el túnel) y compara cada pool persistido con lo que deducen HOY las reglas
 * del juego: `content-pools:migrate` (EXPLICIT, peso 1, `buildPool`) y `content-pools:boost` (RULE, peso 5,
 * cartas con el equipo IMPRESO del sobre, `isTeamPackCard`). Solo los pools que difieren reciben
 * `app_content_pool_set_entries` (la RPC oficial: audita, sube revisión y distribución). Es contenido, no
 * esquema: sin migración. Sin `--commit` termina en ROLLBACK (ensayo); las verificaciones van dentro.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CARDS } from "../src/data/catalog";
import { PACKS } from "../src/data/packs";
import { CardRegistry } from "../src/collection/registry";
import { buildPool } from "../src/domain/packs/pool";
import { DEFAULT_WEIGHT } from "../src/domain/packs/weighted";
import { isTeamPackCard } from "../src/data/teamIdentities";

for (const f of [".env.local", ".env"]) {
  const p = join(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = arg("--out");
const COMMIT = process.argv.includes("--commit");
if (!OUT) { console.error("Uso: npx tsx scripts/cartas-db-pools.ts --out <fichero.sql> [--commit]"); process.exit(1); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

/** Mismo valor que `TEAM_BOOST_WEIGHT` de `content-pools-boost.ts`. */
const TEAM_BOOST_WEIGHT = 5;
const REASON = "Catálogo diseñado · adaptación post-reemplazo (2026-09-21)";
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const jlit = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;

type Entry = { card_id: string; weight: number; mode: "INCLUDE" };

async function main() {
  const registry = new CardRegistry(CARDS);
  const expected = new Map<string, { entries: Entry[]; why: string }>();
  for (const pack of PACKS) {
    const flat = buildPool(registry, pack).flat;
    expected.set(`pack-${pack.id}`, { entries: flat.map((c) => ({ card_id: c.id, weight: DEFAULT_WEIGHT, mode: "INCLUDE" })), why: `pool de ${pack.id}: ${flat.length} cartas elegibles` });
    if (pack.team) {
      const del = flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), pack.team));
      expected.set(`boost-${pack.id}`, { entries: del.map((c) => ({ card_id: c.id, weight: TEAM_BOOST_WEIGHT, mode: "INCLUDE" })), why: `sesgo de ${pack.id}: ${del.length} cartas con el equipo impreso` });
    }
  }

  const persisted = new Map<string, Map<string, number>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("content_pool_entries").select("pool_id, card_id, weight").order("pool_id").order("card_id").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { pool_id: string; card_id: string; weight: number }[]) {
      if (!persisted.has(r.pool_id)) persisted.set(r.pool_id, new Map());
      persisted.get(r.pool_id)!.set(r.card_id, Number(r.weight));
    }
    if (!data || data.length < 1000) break;
  }
  const { data: pools } = await db.from("content_pools").select("id");
  const poolIds = new Set(((pools ?? []) as { id: string }[]).map((p) => p.id));
  for (const id of expected.keys()) if (!poolIds.has(id)) throw new Error(`pool ${id} no existe en la BD: este script no crea pools`);

  const changes: { poolId: string; entries: Entry[]; why: string; before: number }[] = [];
  for (const [poolId, exp] of expected) {
    const cur = persisted.get(poolId) ?? new Map();
    const same = cur.size === exp.entries.length && exp.entries.every((e) => cur.get(e.card_id) === e.weight);
    if (!same) changes.push({ poolId, entries: exp.entries, why: exp.why, before: cur.size });
  }
  const total = [...expected.values()].reduce((s, e) => s + e.entries.length, 0);

  const L: string[] = [];
  L.push(`-- Generado por scripts/cartas-db-pools.ts · ${new Date().toISOString()} · ${COMMIT ? "COMMIT" : "ENSAYO (ROLLBACK)"}`);
  L.push(`-- ${changes.length} pools cambian · ${total} entradas esperadas en total`);
  L.push(`\\set ON_ERROR_STOP on`);
  L.push(`BEGIN;`);
  L.push(`SET LOCAL lock_timeout = '30s';`);
  for (const c of changes) {
    L.push(`-- ${c.poolId}: ${c.before} → ${c.entries.length} (${c.why})`);
    L.push(`SELECT public.app_content_pool_set_entries(${lit(c.poolId)}, ${jlit(c.entries)}, ${lit(`${REASON}: ${c.why}`)}, NULL) IS NOT NULL AS ok_${c.poolId.replace(/[^a-z0-9]/g, "_")};`);
  }
  const exp = Object.fromEntries([...expected].map(([k, v]) => [k, v.entries.length]));
  L.push(`DO $verify$
DECLARE v int; r record; esperado jsonb := ${jlit(exp)};
BEGIN
  FOR r IN SELECT key, value::int AS n FROM jsonb_each_text(esperado) LOOP
    SELECT count(*) INTO v FROM content_pool_entries WHERE pool_id = r.key;
    IF v <> r.n THEN RAISE EXCEPTION 'pool %: % entradas (esperado %)', r.key, v, r.n; END IF;
  END LOOP;
  SELECT count(*) INTO v FROM content_pool_entries; IF v <> ${total} THEN RAISE EXCEPTION 'entradas totales % (esperado ${total})', v; END IF;
  SELECT count(*) INTO v FROM content_pool_entries e LEFT JOIN content_cards c USING (card_id) WHERE c.card_id IS NULL; IF v <> 0 THEN RAISE EXCEPTION '% entradas rotas', v; END IF;
  SELECT count(*) INTO v FROM content_cards; IF v <> ${CARDS.length} THEN RAISE EXCEPTION 'content_cards = %', v; END IF;
  SELECT entries_count INTO v FROM content_distribution_version WHERE id; IF v <> ${total} THEN RAISE EXCEPTION 'entries_count = %', v; END IF;
  RAISE NOTICE 'VERIFICACIÓN OK: ${changes.length} pools actualizados, ${total} entradas, 0 rotas';
END
$verify$;`);
  L.push(`SELECT 'después' AS fase, (SELECT version FROM content_distribution_version) AS version_distribucion, (SELECT count(*) FROM content_pool_entries) AS entradas;`);
  L.push(COMMIT ? `COMMIT;` : `ROLLBACK;`);
  writeFileSync(OUT!, L.join("\n") + "\n", "utf8");
  console.log(`${OUT} · ${COMMIT ? "COMMIT" : "ENSAYO"} · ${changes.length} pools cambian · ${total} entradas`);
  for (const c of changes) console.log(`  ${c.poolId.padEnd(22)} ${String(c.before).padStart(3)} → ${String(c.entries.length).padStart(3)}  ${c.why}`);
}

main().catch((e) => { console.error("✕", e instanceof Error ? e.message : e); process.exit(1); });
