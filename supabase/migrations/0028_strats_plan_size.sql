-- ============================================================================
-- 0028 · TECHO DE TAMAÑO PARA EL PLAN DE UNA ESTRATEGIA
-- ============================================================================
--
-- **Aditiva y reversible. NO es imprescindible para que el Entrenador funcione.**
--
-- ────────────────────────── POR QUÉ ──────────────────────────
--
-- Con el formato 2, cada paso de una estrategia guarda su estado táctico COMPLETO —hasta
-- 5 jugadores, 24 utilidades, 40 dibujos de hasta 64 vértices y 20 anotaciones— y una
-- estrategia admite 12 pasos. `sanitizeStrat` acota cada cosa por separado, pero el
-- producto de todos los topes sigue siendo un jsonb grande.
--
-- La ruta de servidor ya rechaza con 413 cualquier plan saneado que pase de 256 KB. Esto
-- es el mismo techo puesto EN LA BASE, y existe por el mismo motivo que el trigger de
-- `user_strats_limit` de 0017: a PostgREST se llega sin pasar por la aplicación, y las
-- políticas de esta tabla dejan al dueño escribir sus propias filas. Una comprobación que
-- solo vive en Node no protege una tabla en la que el cliente puede escribir.
--
-- ────────────────────────── POR QUÉ NO HAY COLUMNAS NUEVAS ──────────────────────────
--
-- La descripción y las etiquetas de una estrategia viven DENTRO del plan, saneadas por el
-- dominio junto con todo lo demás. Sacarlas a columnas habría creado dos fuentes de verdad
-- para el mismo dato sin que ninguna consulta lo pidiera: nada filtra hoy por descripción
-- ni por etiqueta. El día que haga falta filtrar, se desnormalizan entonces.
--
-- ────────────────────────── LO QUE NO TOCA ──────────────────────────
--
-- Ni las políticas RLS, ni los índices, ni el trigger `touch_updated_at`, ni el tope de 40
-- estrategias por usuario, ni ninguna fila existente: 256 KB es holgadísimo para cualquier
-- estrategia real, así que la restricción no puede invalidar nada de lo ya guardado.
-- ============================================================================

alter table public.user_strats
  drop constraint if exists user_strats_plan_size;

alter table public.user_strats
  add constraint user_strats_plan_size
  check (pg_column_size(plan) <= 262144);

comment on column public.user_strats.plan is
  'Strat completo (formato 2), ya saneado por el dominio: mapa, bando, descripción, '
  'etiquetas y la secuencia de pasos con el estado táctico COMPLETO de cada uno. '
  'Techo de 256 KB, el mismo que aplica la ruta de servidor.';
