/**
 * ICON (2026-10-09) · genera el SQL (UNA transacción) que cambia la receta `pack-champions-icon` de 2:1 a 3:1, con el
 * MISMO efecto que guardarla desde /admin (F73 `saveRecipe`): fila versionada (`version + 1`, `updated_at`) + auditoría
 * append-only en `content_audit_log` (`f73_recipe_save`, antes/después). Actor NULL = operación de operador (como el
 * Plata → Oro 3:1 de Pack Opening 3.0). SIN `--commit` termina en ROLLBACK (ensayo). No toca ningún inventario.
 *
 *   npx tsx scripts/_icon-odds/recipe-sql.ts --out f.sql [--commit]
 *
 * SEGURIDAD (revisión 2026-10-11): transacción REPEATABLE READ (las fotos de «otras recetas» e «inventarios» no se
 * mueven por el tráfico concurrente: si fallan es porque ESTA transacción tocó algo); IDEMPOTENTE (si la receta ya está
 * en el valor de destino no escribe nada —ni fila ni auditoría— y termina bien con «SIN CAMBIOS»); cualquier otro valor
 * de partida aborta. `--revert` es la operación inversa exacta, con las mismas garantías.
 *
 * Alternativa equivalente y preferible si hay un admin conectado: /admin → Crafteo → «Champions → Icon» → cantidad 3.
 */
import { writeFileSync } from "node:fs";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const OUT = arg("--out");
if (!OUT) throw new Error("--out <fichero.sql> es obligatorio");
const COMMIT = process.argv.includes("--commit");
/** `--revert`: la vuelta atrás (3 → 2, nombre anterior), con la misma auditoría y comprobaciones. */
const REVERT = process.argv.includes("--revert");
const ID = "pack-champions-icon";
const FROM = REVERT ? 3 : 2, TO = REVERT ? 2 : 3;
const NAME = REVERT ? "Champions → Icon" : "Champions → ICON Premium";
const REASON = REVERT ? "ICON 2026-10-09 · ROLLBACK: Champions → Icon vuelve a 2:1" : "ICON 2026-10-09 · decisión del propietario: Champions → ICON Premium 3:1 (a 2:1 creaba valor con el Premium de 3 ICON)";
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const L = [
  `-- ICON · ${new Date().toISOString()} · ${COMMIT ? "COMMIT" : "ENSAYO (ROLLBACK)"} · ${ID}: ${FROM} → ${TO}`,
  String.raw`\set ON_ERROR_STOP on`, `BEGIN ISOLATION LEVEL REPEATABLE READ;`, `SET LOCAL lock_timeout = '10s';`,
  // Foto previa: la receta, el resto de recetas y los inventarios implicados (deben quedar idénticos).
  `CREATE TEMP TABLE _icon_before ON COMMIT DROP AS SELECT * FROM public.craft_recipes WHERE id = '${ID}' FOR UPDATE;`,
  `CREATE TEMP TABLE _icon_others ON COMMIT DROP AS SELECT md5(coalesce(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id), '')) AS h FROM public.craft_recipes c WHERE c.id <> '${ID}';`,
  `CREATE TEMP TABLE _icon_packs ON COMMIT DROP AS SELECT md5(coalesce(string_agg(user_id::text || ':' || pack_id || ':' || qty, '|' ORDER BY user_id, pack_id), '')) AS h, count(*) AS n FROM public.user_packs;`,
  `SELECT 'antes' AS fase, id, input_pack_id, output_pack_id, input_qty, status, version, name FROM _icon_before;`,
  `SELECT 'operaciones craft_pack históricas de esta receta' AS info, count(*) FROM public.economy_ops WHERE kind = 'craft_pack' AND result->>'recipeId' = '${ID}';`,
  `DO $pre$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM _icon_before;
  IF NOT FOUND THEN RAISE EXCEPTION 'falta la receta ${ID}'; END IF;
  IF r.kind <> 'PACK' OR r.input_pack_id <> 'champions' OR r.output_pack_id <> 'icon' THEN RAISE EXCEPTION 'la receta no es Champions → icon (%, % → %)', r.kind, r.input_pack_id, r.output_pack_id; END IF;
  IF r.input_qty = ${TO} THEN RAISE NOTICE 'YA APLICADO: ${ID} ya está en ${TO}:1 (versión %). No se escribe nada.', r.version;
  ELSIF r.input_qty <> ${FROM} THEN RAISE EXCEPTION 'input_qty actual % (se esperaba ${FROM} o ${TO})', r.input_qty; END IF;
END $pre$;`,
  `UPDATE public.craft_recipes SET input_qty = ${TO}, name = ${lit(NAME)}, version = version + 1, updated_by = NULL, updated_at = now() WHERE id = '${ID}' AND input_qty = ${FROM};`,
  `INSERT INTO public.content_audit_log (actor, action, entity_type, entity_id, detail)
SELECT NULL, 'f73_recipe_save', 'craft_recipe', '${ID}', jsonb_build_object('before', to_jsonb(b), 'after', (SELECT to_jsonb(c) FROM public.craft_recipes c WHERE c.id = '${ID}'), 'reason', ${lit(REASON)}, 'operator', true)
FROM _icon_before b WHERE b.input_qty = ${FROM};`,
  `DO $verify$
DECLARE r record; v int;
BEGIN
  SELECT * INTO r FROM public.craft_recipes WHERE id = '${ID}';
  IF (SELECT input_qty FROM _icon_before) = ${TO} THEN
    IF to_jsonb(r) <> (SELECT to_jsonb(b) FROM _icon_before b) THEN RAISE EXCEPTION 'ya estaba aplicado y aun así la fila cambió'; END IF;
    RAISE NOTICE 'VERIFICACIÓN OK: SIN CAMBIOS (${ID} ya estaba en ${TO}:1)';
    RETURN;
  END IF;
  IF r.input_qty <> ${TO} OR r.output_pack_id <> 'icon' OR r.input_pack_id <> 'champions' OR r.status <> (SELECT status FROM _icon_before) THEN RAISE EXCEPTION 'receta mal aplicada: % % → % (%)', r.input_qty, r.input_pack_id, r.output_pack_id, r.status; END IF;
  IF r.version <> (SELECT version + 1 FROM _icon_before) THEN RAISE EXCEPTION 'versión % (se esperaba %)', r.version, (SELECT version + 1 FROM _icon_before); END IF;
  IF (SELECT md5(coalesce(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id), '')) FROM public.craft_recipes c WHERE c.id <> '${ID}') <> (SELECT h FROM _icon_others) THEN RAISE EXCEPTION 'se ha tocado OTRA receta'; END IF;
  IF (SELECT md5(coalesce(string_agg(user_id::text || ':' || pack_id || ':' || qty, '|' ORDER BY user_id, pack_id), '')) FROM public.user_packs) <> (SELECT h FROM _icon_packs) THEN RAISE EXCEPTION 'se ha tocado un inventario de sobres'; END IF;
  SELECT count(*) INTO v FROM public.content_audit_log WHERE entity_type = 'craft_recipe' AND entity_id = '${ID}' AND action = 'f73_recipe_save' AND at >= now() - interval '1 minute';
  IF v < 1 THEN RAISE EXCEPTION 'falta la auditoría'; END IF;
  RAISE NOTICE 'VERIFICACIÓN OK: ${ID} ${FROM} → ${TO}, versión +1, auditada; otras recetas e inventarios idénticos';
END $verify$;`,
  `SELECT 'después' AS fase, id, input_qty, status, version, name FROM public.craft_recipes WHERE id = '${ID}';`,
  COMMIT ? `COMMIT;` : `ROLLBACK;`,
  // Tras un ROLLBACK, la prueba de que NO quedó nada:
  ...(COMMIT ? [] : [`SELECT 'tras ROLLBACK' AS fase, id, input_qty, version FROM public.craft_recipes WHERE id = '${ID}';`]),
];
writeFileSync(OUT, L.join("\n") + "\n", "utf8");
console.log(`${OUT} · ${COMMIT ? "COMMIT" : "ENSAYO"} · ${FROM} → ${TO}`);
