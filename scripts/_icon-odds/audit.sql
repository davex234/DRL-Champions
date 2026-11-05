-- ICON (2026-10-09) · AUDITORÍA DE SOLO LECTURA del estado de producción, ejecutada sobre una COPIA restaurada del backup
-- `pre-icon-rc` en un contenedor desechable sin red (scripts/_icon-odds/sandbox.sh). Nunca contra la BD viva.
\set ON_ERROR_STOP on
\pset footer off
BEGIN READ ONLY;
\echo '== receta Champions → Icon (estado actual)'
SELECT id, input_pack_id, output_pack_id, input_qty, status, version, name, updated_at FROM public.craft_recipes WHERE id = 'pack-champions-icon';
\echo '== todas las recetas de SOBRES'
SELECT id, input_pack_id || ' → ' || output_pack_id AS ruta, input_qty, status, version FROM public.craft_recipes WHERE kind = 'PACK' ORDER BY sort_order, id;
\echo '== sobres icon / icon-single en inventarios (no se tocan)'
SELECT pack_id, count(*) FILTER (WHERE qty > 0) AS jugadores_con_sobre, coalesce(sum(qty), 0) AS sobres_sin_abrir FROM public.user_packs WHERE pack_id IN ('icon', 'icon-single') GROUP BY pack_id;
\echo '== Champions sin abrir: quién podría usar la receta (antes con 2, ahora con 3)'
SELECT count(*) FILTER (WHERE qty >= 2) AS con_2_o_mas, count(*) FILTER (WHERE qty >= 3) AS con_3_o_mas, count(*) FILTER (WHERE qty = 2) AS con_exactamente_2 FROM public.user_packs WHERE pack_id = 'champions';
\echo '== historial de crafteo Champions → Icon (operaciones ya hechas: se conservan)'
SELECT count(*) AS operaciones, min(created_at) AS primera, max(created_at) AS ultima FROM public.economy_ops WHERE kind = 'craft_pack' AND result->>'recipeId' = 'pack-champions-icon';
\echo '== compras históricas de sobres icon (asientos del libro mayor: se conservan con su importe)'
SELECT reason, count(*) AS asientos, sum(delta) AS total FROM public.credit_transactions WHERE reason IN ('buy_pack:icon', 'buy_pack:icon-single') GROUP BY reason;
\echo '== ¿hay tablas de pedidos/pagos/colas con estado pendiente?'
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name ~ '(order|payment|purchase|checkout|pending|queue|request)') ORDER BY 1;
\echo '== pagos (PAYMENTS_ENABLED = false): filas por estado'
SELECT status, count(*) FROM public.payments GROUP BY status;
SELECT count(*) AS pagos_total FROM public.payments;
\echo '== plantillas del panel (content_packs) basadas en icon'
SELECT id, template_pack_id, card_count, price, lifecycle FROM public.content_packs WHERE template_pack_id IN ('icon', 'icon-single');
SELECT count(*) AS content_packs_total FROM public.content_packs;
\echo '== pools de los sobres icon (icon-single aún no tiene)'
SELECT pack_id, pool_id, priority, enabled FROM public.content_pack_pools WHERE pack_id IN ('icon', 'icon-single');
SELECT id, mode, lifecycle, (SELECT count(*) FROM public.content_pool_entries e WHERE e.pool_id = p.id) AS entradas FROM public.content_pools p WHERE id IN ('pack-icon', 'pack-icon-single');
\echo '== cartas ICON del catálogo VIVO (content_cards): ¿las mismas 3?'
SELECT card_id, variant_id, ovr FROM public.content_cards WHERE variant_id IN ('record-breaker', 'moments') ORDER BY card_id;
\echo '== recompensas que entregan sobres icon ya concedidas (economy_ops con icon en outputs)'
SELECT kind, count(*) FROM public.economy_ops WHERE result::text LIKE '%"packId": "icon"%' OR result::text LIKE '%"packId":"icon"%' GROUP BY kind ORDER BY 2 DESC;
COMMIT;
