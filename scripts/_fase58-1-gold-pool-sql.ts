/**
 * F58.1 · genera el SQL (UNA transacción) que da al Sobre Oro su pool de elegibilidad con el MECANISMO CANÓNICO de
 * `content-pools:migrate` (las 4 RPC oficiales, solo para `oro`): upsert → set_entries → bind(100) → publish.
 * Verificaciones dentro; sin `--commit` termina en ROLLBACK.  npx tsx scripts/_fase58-1-gold-pool-sql.ts --out f.sql [--commit]
 */
import { writeFileSync } from "node:fs";
import { CardRegistry } from "@/collection";
import { getPack } from "@/data/packs";
import { buildPool } from "@/domain/packs/pool";
import { DEFAULT_WEIGHT } from "@/domain/packs/weighted";
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = arg("--out")!, COMMIT = process.argv.includes("--commit");
const oro = getPack("oro")!;
const flat = buildPool(new CardRegistry(), oro, null).flat;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const entries = flat.map((c) => ({ card_id: c.id, weight: DEFAULT_WEIGHT, mode: "INCLUDE" }));
const REASON = "F58.1 · Sobre Oro: pool de elegibilidad que faltaba (mismo mecanismo y contenido que los otros 5 sobres de la línea principal)";
const L = [
  `-- F58.1 · ${new Date().toISOString()} · ${COMMIT ? "COMMIT" : "ENSAYO (ROLLBACK)"} · pack-oro con ${entries.length} entradas`,
  // F58.1 · OJO: en un template literal `\s` NO es escape y se queda en «s» (así se perdió el backslash y el BEGIN).
  String.raw`\set ON_ERROR_STOP on`, `BEGIN;`, `SET LOCAL lock_timeout = '30s';`,
  `SELECT 'antes' AS fase, (SELECT version FROM content_distribution_version) AS version, (SELECT count(*) FROM content_pack_pools WHERE pack_id = 'oro') AS vinculos_oro;`,
  `SELECT public.app_content_pool_upsert(${lit(JSON.stringify({ id: "pack-oro", name: `Pool de ${oro.name}`, description: `Pertenencia explícita de PackDef.oro (F58.1), peso ${DEFAULT_WEIGHT}. La probabilidad la decide la tabla por clase F57.3.`, mode: "EXPLICIT", rules: {}, event_id: null, season_id: null }))}::jsonb, ${lit(REASON)}, NULL) IS NOT NULL AS ok_upsert;`,
  `SELECT public.app_content_pool_set_entries('pack-oro', ${lit(JSON.stringify(entries))}::jsonb, ${lit(REASON)}, NULL) IS NOT NULL AS ok_entries;`,
  `SELECT public.app_content_pack_bind('oro', 'pack-oro', 100, 'bind', NULL) IS NOT NULL AS ok_bind;`,
  `SELECT public.app_content_pool_publish('pack-oro', 'ACTIVE', NULL, ${lit(REASON)}) IS NOT NULL AS ok_publish;`,
  `DO $verify$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM content_pool_entries WHERE pool_id = 'pack-oro'; IF v <> ${entries.length} THEN RAISE EXCEPTION 'pack-oro: % entradas', v; END IF;
  SELECT count(*) INTO v FROM content_pool_entries WHERE pool_id = 'pack-oro' AND (weight <> 1 OR mode <> 'INCLUDE'); IF v <> 0 THEN RAISE EXCEPTION 'pack-oro: % entradas con peso/modo distinto', v; END IF;
  SELECT count(*) INTO v FROM ((SELECT card_id FROM content_pool_entries WHERE pool_id = 'pack-oro') EXCEPT (SELECT card_id FROM content_pool_entries WHERE pool_id = 'pack-estandar')) x; IF v <> 0 THEN RAISE EXCEPTION 'pack-oro tiene % cartas que pack-estandar no', v; END IF;
  SELECT count(*) INTO v FROM ((SELECT card_id FROM content_pool_entries WHERE pool_id = 'pack-estandar') EXCEPT (SELECT card_id FROM content_pool_entries WHERE pool_id = 'pack-oro')) x; IF v <> 0 THEN RAISE EXCEPTION 'a pack-oro le faltan % cartas de pack-estandar', v; END IF;
  SELECT count(*) INTO v FROM content_pools WHERE id = 'pack-oro' AND lifecycle = 'ACTIVE' AND mode = 'EXPLICIT'; IF v <> 1 THEN RAISE EXCEPTION 'pack-oro no está ACTIVE/EXPLICIT'; END IF;
  SELECT count(*) INTO v FROM content_pack_pools WHERE pack_id = 'oro' AND pool_id = 'pack-oro' AND priority = 100 AND enabled; IF v <> 1 THEN RAISE EXCEPTION 'vínculo oro→pack-oro ausente'; END IF;
  SELECT count(*) INTO v FROM content_pack_pools WHERE pack_id = 'oro'; IF v <> 1 THEN RAISE EXCEPTION 'oro tiene % vínculos', v; END IF;
  SELECT count(*) INTO v FROM content_pool_entries e LEFT JOIN content_cards c USING (card_id) WHERE c.card_id IS NULL; IF v <> 0 THEN RAISE EXCEPTION '% entradas rotas', v; END IF;
  RAISE NOTICE 'VERIFICACIÓN OK: pack-oro ACTIVE/EXPLICIT, ${entries.length} entradas = pack-estandar, peso 1, vínculo @100';
END $verify$;`,
  `SELECT 'después' AS fase, (SELECT version FROM content_distribution_version) AS version, (SELECT count(*) FROM content_pack_pools WHERE pack_id = 'oro') AS vinculos_oro, (SELECT count(*) FROM content_pool_entries) AS entradas;`,
  COMMIT ? `COMMIT;` : `ROLLBACK;`,
];
writeFileSync(OUT, L.join("\n") + "\n", "utf8");
console.log(`${OUT} · ${COMMIT ? "COMMIT" : "ENSAYO"} · ${entries.length} entradas`);
