/**
 * ICON (2026-10-09) · genera el SQL (UNA transacción) que da al Sobre ICON nuevo (`icon-single`) su pool de elegibilidad
 * `pack-icon-single` con el MECANISMO CANÓNICO de F58.1 (las 4 RPC oficiales): upsert → set_entries → bind(100) → publish.
 * Mismo contenido que los demás sobres de la línea (catálogo entero, peso 1, INCLUDE): la probabilidad la decide el plan.
 * Verificaciones dentro; SIN `--commit` termina en ROLLBACK (ensayo).
 *
 *   npx tsx scripts/_icon-odds/pool-sql.ts --out /tmp/icon-single-pool.sql [--commit]
 *
 * NO se ha ejecutado contra ninguna BD. Es un paso del despliegue (ver docs/product/icon-odds-2026-10-09.md).
 */
import { writeFileSync } from "node:fs";
import { CardRegistry } from "@/collection";
import { getPack } from "@/data/packs";
import { buildPool } from "@/domain/packs/pool";
import { DEFAULT_WEIGHT } from "@/domain/packs/weighted";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = arg("--out");
if (!OUT) throw new Error("--out <fichero.sql> es obligatorio");
const COMMIT = process.argv.includes("--commit");
/** `--revert`: desvincula el pool del sobre y lo retira (no borra filas: el registro de auditoría lo conserva). */
const REVERT = process.argv.includes("--revert");
const PACK = "icon-single", POOL = `pack-${PACK}`;
const pack = getPack(PACK)!;
const flat = buildPool(new CardRegistry(), pack, null).flat;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const entries = flat.map((c) => ({ card_id: c.id, weight: DEFAULT_WEIGHT, mode: "INCLUDE" }));
const REASON = "ICON 2026-10-09 · Sobre ICON (1 carta): pool de elegibilidad, mismo mecanismo y contenido que los demás sobres de la línea";
const VERIFY_APPLY = `DO $verify$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM content_pool_entries WHERE pool_id = '${POOL}'; IF v <> ${entries.length} THEN RAISE EXCEPTION '${POOL}: % entradas', v; END IF;
  SELECT count(*) INTO v FROM content_pool_entries WHERE pool_id = '${POOL}' AND (weight <> 1 OR mode <> 'INCLUDE'); IF v <> 0 THEN RAISE EXCEPTION '${POOL}: % entradas con peso/modo distinto', v; END IF;
  SELECT count(*) INTO v FROM ((SELECT card_id FROM content_pool_entries WHERE pool_id = '${POOL}') EXCEPT (SELECT card_id FROM content_pool_entries WHERE pool_id = 'pack-icon')) x; IF v <> 0 THEN RAISE EXCEPTION '${POOL} tiene % cartas que pack-icon no', v; END IF;
  SELECT count(*) INTO v FROM ((SELECT card_id FROM content_pool_entries WHERE pool_id = 'pack-icon') EXCEPT (SELECT card_id FROM content_pool_entries WHERE pool_id = '${POOL}')) x; IF v <> 0 THEN RAISE EXCEPTION 'a ${POOL} le faltan % cartas de pack-icon', v; END IF;
  SELECT count(*) INTO v FROM content_pools WHERE id = '${POOL}' AND lifecycle = 'ACTIVE' AND mode = 'EXPLICIT'; IF v <> 1 THEN RAISE EXCEPTION '${POOL} no está ACTIVE/EXPLICIT'; END IF;
  SELECT count(*) INTO v FROM content_pack_pools WHERE pack_id = '${PACK}' AND pool_id = '${POOL}' AND priority = 100 AND enabled; IF v <> 1 THEN RAISE EXCEPTION 'vínculo ${PACK}→${POOL} ausente'; END IF;
  SELECT count(*) INTO v FROM content_pack_pools WHERE pack_id = '${PACK}'; IF v <> 1 THEN RAISE EXCEPTION '${PACK} tiene % vínculos', v; END IF;
  SELECT count(*) INTO v FROM content_pool_entries e LEFT JOIN content_cards c USING (card_id) WHERE c.card_id IS NULL; IF v <> 0 THEN RAISE EXCEPTION '% entradas rotas', v; END IF;
  RAISE NOTICE 'VERIFICACIÓN OK: ${POOL} ACTIVE/EXPLICIT, ${entries.length} entradas = pack-icon, peso 1, vínculo @100';
END $verify$;`;
const POOL_JSON = JSON.stringify({ id: POOL, name: `Pool de ${pack.name}`, description: `Pertenencia explícita de PackDef.${PACK}, peso ${DEFAULT_WEIGHT}. La probabilidad la decide el plan por clase (100 % Icon) y la tabla de calidad.`, mode: "EXPLICIT", rules: {}, event_id: null, season_id: null });
/**
 * SEGURIDAD (revisión 2026-10-11, ensayada en una copia del contenido de producción): el paso es IDEMPOTENTE y
 * REAPLICABLE. Decide según el estado real: ya aplicado → no escribe nada; pool RETIRED (tras un --revert) → lo reactiva
 * por la RPC oficial (deja rastro) y lo vuelve a vincular; estado parcial → completa lo que falte. Solo usa las 4 RPC.
 */
const L = [
  `-- ICON · ${new Date().toISOString()} · ${COMMIT ? "COMMIT" : "ENSAYO (ROLLBACK)"} · ${POOL} con ${entries.length} entradas`,
  String.raw`\set ON_ERROR_STOP on`, `BEGIN;`, `SET LOCAL lock_timeout = '30s';`,
  `SELECT 'antes' AS fase, (SELECT version FROM content_distribution_version) AS version, (SELECT lifecycle FROM content_pools WHERE id = '${POOL}') AS pool, (SELECT count(*) FROM content_pack_pools WHERE pack_id = '${PACK}') AS vinculos;`,
  `CREATE TEMP TABLE _want ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(${lit(JSON.stringify(entries))}::jsonb) AS x(card_id text, weight int, mode text);`,
  `DO $apply$
DECLARE v_life text; v_same boolean; v_bound boolean;
BEGIN
  SELECT lifecycle INTO v_life FROM content_pools WHERE id = '${POOL}';
  SELECT NOT EXISTS ((SELECT card_id, weight::int, mode::text FROM content_pool_entries WHERE pool_id = '${POOL}') EXCEPT (SELECT card_id, weight, mode FROM _want))
     AND NOT EXISTS ((SELECT card_id, weight, mode FROM _want) EXCEPT (SELECT card_id, weight::int, mode::text FROM content_pool_entries WHERE pool_id = '${POOL}')) INTO v_same;
  SELECT count(*) FILTER (WHERE pool_id = '${POOL}' AND priority = 100 AND enabled) = 1 AND count(*) = 1 INTO v_bound FROM content_pack_pools WHERE pack_id = '${PACK}';
  IF v_life = 'ACTIVE' AND v_same AND v_bound THEN
    RAISE NOTICE 'YA APLICADO: ${POOL} ACTIVE, ${entries.length} entradas, vínculo @100. No se escribe nada.';
    RETURN;
  END IF;
  IF v_life = 'RETIRED' THEN
    PERFORM public.app_content_pool_publish('${POOL}', 'ACTIVE', NULL, ${lit(REASON + " · reactivación")});
    v_life := 'ACTIVE';
    RAISE NOTICE 'pool RETIRED reactivado';
  END IF;
  PERFORM public.app_content_pool_upsert(${lit(POOL_JSON)}::jsonb, ${lit(REASON)}, NULL);
  IF NOT v_same THEN PERFORM public.app_content_pool_set_entries('${POOL}', (SELECT jsonb_agg(to_jsonb(w)) FROM _want w), ${lit(REASON)}, NULL); END IF;
  IF NOT v_bound THEN PERFORM public.app_content_pack_bind('${PACK}', '${POOL}', 100, 'bind', NULL); END IF;
  IF v_life IS DISTINCT FROM 'ACTIVE' THEN PERFORM public.app_content_pool_publish('${POOL}', 'ACTIVE', NULL, ${lit(REASON)}); END IF;
  RAISE NOTICE 'APLICADO';
END $apply$;`,
  VERIFY_APPLY,
  `SELECT 'después' AS fase, (SELECT version FROM content_distribution_version) AS version, (SELECT lifecycle FROM content_pools WHERE id = '${POOL}') AS pool, (SELECT count(*) FROM content_pack_pools WHERE pack_id = '${PACK}') AS vinculos;`,
  COMMIT ? `COMMIT;` : `ROLLBACK;`,
  ...(COMMIT ? [] : [`SELECT 'tras ROLLBACK' AS fase, (SELECT version FROM content_distribution_version) AS version, (SELECT lifecycle FROM content_pools WHERE id = '${POOL}') AS pool, (SELECT count(*) FROM content_pack_pools WHERE pack_id = '${PACK}') AS vinculos;`]),
];
const R = [
  `-- ICON · ${new Date().toISOString()} · ${COMMIT ? "COMMIT" : "ENSAYO (ROLLBACK)"} · ROLLBACK de ${POOL}`,
  String.raw`\set ON_ERROR_STOP on`, `BEGIN;`, `SET LOCAL lock_timeout = '30s';`,
  `DO $revert$
DECLARE v_life text;
BEGIN
  SELECT lifecycle INTO v_life FROM content_pools WHERE id = '${POOL}';
  IF v_life IS NULL THEN RAISE NOTICE 'NADA QUE REVERTIR: ${POOL} no existe'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM content_pack_pools WHERE pack_id = '${PACK}' AND pool_id = '${POOL}') THEN
    PERFORM public.app_content_pack_bind('${PACK}', '${POOL}', 100, 'unbind', NULL);
  END IF;
  IF v_life = 'RETIRED' THEN RAISE NOTICE 'YA REVERTIDO: ${POOL} ya estaba RETIRED';
  ELSIF v_life = 'ACTIVE' THEN PERFORM public.app_content_pool_publish('${POOL}', 'RETIRED', NULL, ${lit("ICON 2026-10-09 · ROLLBACK del pool del Sobre ICON")});
  ELSE RAISE EXCEPTION '${POOL} está en % (se esperaba ACTIVE o RETIRED)', v_life; END IF;
END $revert$;`,
  `DO $verify$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM content_pack_pools WHERE pack_id = '${PACK}' AND enabled; IF v <> 0 THEN RAISE EXCEPTION '${PACK} sigue con % vínculos', v; END IF;
  SELECT count(*) INTO v FROM content_pools WHERE id = '${POOL}' AND lifecycle <> 'RETIRED'; IF v <> 0 THEN RAISE EXCEPTION '${POOL} no está RETIRED'; END IF;
  RAISE NOTICE 'VERIFICACIÓN OK: ${PACK} sin vínculo; ${POOL} RETIRED o inexistente';
END $verify$;`,
  COMMIT ? `COMMIT;` : `ROLLBACK;`,
];
writeFileSync(OUT, (REVERT ? R : L).join("\n") + "\n", "utf8");
console.log(`${OUT} · ${COMMIT ? "COMMIT" : "ENSAYO"} · ${REVERT ? "ROLLBACK del pool" : `${entries.length} entradas`}`);
