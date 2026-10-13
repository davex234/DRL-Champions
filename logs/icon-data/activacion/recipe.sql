-- ICON · 2026-10-12T10:47:14.465Z · ENSAYO (ROLLBACK) · pack-champions-icon: 2 → 3
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '10s';
CREATE TEMP TABLE _icon_before ON COMMIT DROP AS SELECT * FROM public.craft_recipes WHERE id = 'pack-champions-icon' FOR UPDATE;
CREATE TEMP TABLE _icon_others ON COMMIT DROP AS SELECT md5(coalesce(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id), '')) AS h FROM public.craft_recipes c WHERE c.id <> 'pack-champions-icon';
CREATE TEMP TABLE _icon_packs ON COMMIT DROP AS SELECT md5(coalesce(string_agg(user_id::text || ':' || pack_id || ':' || qty, '|' ORDER BY user_id, pack_id), '')) AS h, count(*) AS n FROM public.user_packs;
SELECT 'antes' AS fase, id, input_pack_id, output_pack_id, input_qty, status, version, name FROM _icon_before;
SELECT 'operaciones craft_pack históricas de esta receta' AS info, count(*) FROM public.economy_ops WHERE kind = 'craft_pack' AND result->>'recipeId' = 'pack-champions-icon';
DO $pre$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM _icon_before;
  IF NOT FOUND THEN RAISE EXCEPTION 'falta la receta pack-champions-icon'; END IF;
  IF r.kind <> 'PACK' OR r.input_pack_id <> 'champions' OR r.output_pack_id <> 'icon' THEN RAISE EXCEPTION 'la receta no es Champions → icon (%, % → %)', r.kind, r.input_pack_id, r.output_pack_id; END IF;
  IF r.input_qty = 3 THEN RAISE NOTICE 'YA APLICADO: pack-champions-icon ya está en 3:1 (versión %). No se escribe nada.', r.version;
  ELSIF r.input_qty <> 2 THEN RAISE EXCEPTION 'input_qty actual % (se esperaba 2 o 3)', r.input_qty; END IF;
END $pre$;
UPDATE public.craft_recipes SET input_qty = 3, name = 'Champions → ICON Premium', version = version + 1, updated_by = NULL, updated_at = now() WHERE id = 'pack-champions-icon' AND input_qty = 2;
INSERT INTO public.content_audit_log (actor, action, entity_type, entity_id, detail)
SELECT NULL, 'f73_recipe_save', 'craft_recipe', 'pack-champions-icon', jsonb_build_object('before', to_jsonb(b), 'after', (SELECT to_jsonb(c) FROM public.craft_recipes c WHERE c.id = 'pack-champions-icon'), 'reason', 'ICON 2026-10-09 · decisión del propietario: Champions → ICON Premium 3:1 (a 2:1 creaba valor con el Premium de 3 ICON)', 'operator', true)
FROM _icon_before b WHERE b.input_qty = 2;
DO $verify$
DECLARE r record; v int;
BEGIN
  SELECT * INTO r FROM public.craft_recipes WHERE id = 'pack-champions-icon';
  IF (SELECT input_qty FROM _icon_before) = 3 THEN
    IF to_jsonb(r) <> (SELECT to_jsonb(b) FROM _icon_before b) THEN RAISE EXCEPTION 'ya estaba aplicado y aun así la fila cambió'; END IF;
    RAISE NOTICE 'VERIFICACIÓN OK: SIN CAMBIOS (pack-champions-icon ya estaba en 3:1)';
    RETURN;
  END IF;
  IF r.input_qty <> 3 OR r.output_pack_id <> 'icon' OR r.input_pack_id <> 'champions' OR r.status <> (SELECT status FROM _icon_before) THEN RAISE EXCEPTION 'receta mal aplicada: % % → % (%)', r.input_qty, r.input_pack_id, r.output_pack_id, r.status; END IF;
  IF r.version <> (SELECT version + 1 FROM _icon_before) THEN RAISE EXCEPTION 'versión % (se esperaba %)', r.version, (SELECT version + 1 FROM _icon_before); END IF;
  IF (SELECT md5(coalesce(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id), '')) FROM public.craft_recipes c WHERE c.id <> 'pack-champions-icon') <> (SELECT h FROM _icon_others) THEN RAISE EXCEPTION 'se ha tocado OTRA receta'; END IF;
  IF (SELECT md5(coalesce(string_agg(user_id::text || ':' || pack_id || ':' || qty, '|' ORDER BY user_id, pack_id), '')) FROM public.user_packs) <> (SELECT h FROM _icon_packs) THEN RAISE EXCEPTION 'se ha tocado un inventario de sobres'; END IF;
  SELECT count(*) INTO v FROM public.content_audit_log WHERE entity_type = 'craft_recipe' AND entity_id = 'pack-champions-icon' AND action = 'f73_recipe_save' AND at >= now() - interval '1 minute';
  IF v < 1 THEN RAISE EXCEPTION 'falta la auditoría'; END IF;
  RAISE NOTICE 'VERIFICACIÓN OK: pack-champions-icon 2 → 3, versión +1, auditada; otras recetas e inventarios idénticos';
END $verify$;
SELECT 'después' AS fase, id, input_qty, status, version, name FROM public.craft_recipes WHERE id = 'pack-champions-icon';
ROLLBACK;
SELECT 'tras ROLLBACK' AS fase, id, input_qty, version FROM public.craft_recipes WHERE id = 'pack-champions-icon';
