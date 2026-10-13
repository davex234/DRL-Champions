-- ============================================================================================================
-- 0074 · COLECCIONES ILIMITADAS — índice de cursor y resumen por carta en la base.
--
-- Contexto: PostgREST corta cada respuesta en `max_rows` (1.000) sin avisar. El estado de juego leía `user_cards`
-- de una vez, así que una cuenta con más de 1.000 cartas veía —y el motor de sobres, el desguace y las misiones
-- decidían sobre— un subconjunto arbitrario de su colección.
--
-- El arreglo está en el código (lecturas por cursor, completas o error; ver `src/server/db/keyset.ts` y
-- `src/server/services/userCards.ts`). Esta migración NO es necesaria para que sea correcto: lo hace BARATO.
--
--   1. `user_cards_user_uid_idx (user_id, uid)`: el cursor `user_id = ? and uid > ? order by uid limit n` pasa a ser
--      un recorrido de índice. Sin él, cada página ordena todas las cartas del usuario.
--   2. `user_cards_user_card_uid_idx (user_id, card_id, uid)`: lo mismo para «las copias de ESTA carta» (ficha de
--      carta, desguace por carta, listados filtrados). Sustituye en la práctica a `user_cards_user_card_idx`, que se
--      conserva: quitar un índice no es asunto de esta migración.
--   3. `app_collection_summary(p_user)`: una línea por carta poseída (copias, copias en venta, copias numeradas, primera obtención
--      y el mejor ejemplar), en UNA consulta y como `jsonb`. Su tamaño lo acota el catálogo, no la colección. Si la función
--      no existe, el servidor calcula lo mismo recorriendo la colección por cursor (más consultas, mismo resultado):
--      el orden entre desplegar el código y aplicar esta migración no importa.
--
-- No cambia ninguna tabla, ninguna fila, ninguna política ni ninguna función existente. No toca la economía.
--
-- Rollback: docs/operations/rollback/0074_collection_scale.ROLLBACK.sql (borra la función y los dos índices).
-- ============================================================================================================

-- ── 1 y 2 · índices de cursor ───────────────────────────────────────────────────────────────────────────────
-- Fuera de transacción y CONCURRENTLY se evitaría el bloqueo de escrituras; `supabase db push` y el procedimiento
-- manual del VPS aplican el fichero dentro de una transacción, donde CONCURRENTLY no está permitido. Con el volumen
-- actual (cientos de filas) el bloqueo dura milisegundos. Para una tabla grande, crear los índices a mano con
-- `create index concurrently if not exists …` ANTES de aplicar este fichero: `if not exists` los respetará.
create index if not exists user_cards_user_uid_idx      on public.user_cards (user_id, uid);
create index if not exists user_cards_user_card_uid_idx on public.user_cards (user_id, card_id, uid);

-- ── 3 · resumen por carta ───────────────────────────────────────────────────────────────────────────────────
-- «Mejor ejemplar» = número de serie más bajo; sin serie, `uid` más bajo. Es el orden canónico del álbum
-- (`sortInstances` en `domain/collection/room.ts`) y el de `betterInstance` en el servidor: los tres deben coincidir.
create or replace function public.app_collection_summary(p_user uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with ranked as (
    select uc.uid, uc.card_id, uc.serial, uc.minted_version, uc.obtained_at, uc.origin, uc.locked,
           row_number() over (partition by uc.card_id order by uc.serial asc nulls last, uc.uid asc) as rn,
           count(*)                              over (partition by uc.card_id) as n,
           count(*) filter (where uc.locked)     over (partition by uc.card_id) as locked_n,
           count(uc.serial)                      over (partition by uc.card_id) as numbered_n,
           min(uc.obtained_at)                   over (partition by uc.card_id) as first_at
      from public.user_cards uc
     where uc.user_id = p_user
  ), per_card as (
    select * from ranked where rn = 1
  )
  select jsonb_build_object(
    'total',    coalesce((select sum(n) from per_card), 0),
    'distinct', (select count(*) from per_card),
    'cards',    coalesce((
      select jsonb_agg(jsonb_build_object(
               'card_id',  c.card_id,
               'n',        c.n,
               'locked',   c.locked_n,
               'numbered', c.numbered_n,
               'first_at', c.first_at,
               'rep', jsonb_build_object(
                 'uid', c.uid, 'serial', c.serial, 'minted_version', c.minted_version,
                 'obtained_at', c.obtained_at, 'origin', c.origin, 'locked', c.locked)
             ) order by c.card_id)
        from per_card c), '[]'::jsonb));
$$;

comment on function public.app_collection_summary(uuid) is
  'COLECCIONES ILIMITADAS · resumen por carta de la colección de un usuario (copias, en venta, primera obtención, mejor ejemplar). Solo servidor (service_role).';

-- Solo el servidor (que pasa el usuario del token) puede llamarla: recibe el usuario como parámetro, así que
-- expuesta a `authenticated` permitiría leer la colección de cualquiera.
revoke all on function public.app_collection_summary(uuid) from public;
revoke all on function public.app_collection_summary(uuid) from anon, authenticated;
grant execute on function public.app_collection_summary(uuid) to service_role;
