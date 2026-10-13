-- ICON · 2026-10-12T10:47:19.966Z · ENSAYO (ROLLBACK) · ROLLBACK de pack-icon-single
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '30s';
DO $revert$
DECLARE v_life text;
BEGIN
  SELECT lifecycle INTO v_life FROM content_pools WHERE id = 'pack-icon-single';
  IF v_life IS NULL THEN RAISE NOTICE 'NADA QUE REVERTIR: pack-icon-single no existe'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM content_pack_pools WHERE pack_id = 'icon-single' AND pool_id = 'pack-icon-single') THEN
    PERFORM public.app_content_pack_bind('icon-single', 'pack-icon-single', 100, 'unbind', NULL);
  END IF;
  IF v_life = 'RETIRED' THEN RAISE NOTICE 'YA REVERTIDO: pack-icon-single ya estaba RETIRED';
  ELSIF v_life = 'ACTIVE' THEN PERFORM public.app_content_pool_publish('pack-icon-single', 'RETIRED', NULL, 'ICON 2026-10-09 · ROLLBACK del pool del Sobre ICON');
  ELSE RAISE EXCEPTION 'pack-icon-single está en % (se esperaba ACTIVE o RETIRED)', v_life; END IF;
END $revert$;
DO $verify$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM content_pack_pools WHERE pack_id = 'icon-single' AND enabled; IF v <> 0 THEN RAISE EXCEPTION 'icon-single sigue con % vínculos', v; END IF;
  SELECT count(*) INTO v FROM content_pools WHERE id = 'pack-icon-single' AND lifecycle <> 'RETIRED'; IF v <> 0 THEN RAISE EXCEPTION 'pack-icon-single no está RETIRED'; END IF;
  RAISE NOTICE 'VERIFICACIÓN OK: icon-single sin vínculo; pack-icon-single RETIRED o inexistente';
END $verify$;
ROLLBACK;
