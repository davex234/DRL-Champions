-- ============================================================================
-- 0042 — POOL & DROP DISTRIBUTION MANAGER: CONCURRENCIA Y DIARIO
-- ============================================================================
--
-- Bloque 8.4.3.
--
-- La infraestructura de 8.3 está entera y no se toca: las tablas, la composición, la
-- invalidación por versión y las cuatro operaciones transaccionales siguen exactamente
-- igual. Lo que esta migración añade es lo que la auditoría de 8.4.3 echó en falta al ir
-- a construir el panel.
--
-- ────────────────────────── 1. NADIE VIGILA QUIÉN LLEGÓ ANTES ──────────────────────────
--
-- `app_content_pool_set_entries` **reemplaza el conjunto entero** de entradas, y eso es
-- correcto: una secuencia de altas y bajas sueltas tendría estados intermedios observables,
-- y el estado intermedio de un pool es una distribución que nadie quiso publicar.
--
-- Pero al reemplazarlo todo, dos administradores trabajando a la vez sobre el mismo pool se
-- pisan **en silencio**: A añade una carta, B cambia un peso, B guarda con la lista que leyó
-- antes, y la carta de A desaparece sin que nada lo diga. Con 772 entradas en un pool, eso no
-- es una hipótesis de laboratorio.
--
-- La solución es la misma que 8.4.1 §7 dejó escrita para las cartas, y por el mismo motivo:
-- `content_pools.revision` ya existe y `_bump_distribution` la sube **en la misma
-- transacción** que el cambio. Es decir, ya hay un testigo; solo faltaba comprobarlo. Y se
-- comprueba **DENTRO** de la función, después del `for update`: hacerlo en la ruta protege del
-- caso lento pero no del simultáneo, porque dos lecturas concurrentes pasan las dos.
--
-- `p_expected_revision` es opcional para no romper a ningún llamante existente; el panel lo
-- envía siempre.
--
-- ────────────────────────── 2. LOS POOLS NO DEJABAN RASTRO ──────────────────────────
--
-- `content_audit_log` nació en 0040, DESPUÉS de los pools, así que cambiar la distribución
-- —qué cartas salen y con qué peso, que es de lo más sensible que se puede tocar en este
-- juego— no escribía ni una línea en el diario. Las cuatro RPC de 8.3 pasan a auditar, y el
-- diario ya tenía la columna `pool_id` esperando desde 0040.
--
-- El detalle registra el CAMBIO, no la configuración entera: qué entradas entran, cuáles
-- salen y qué pesos se mueven. Guardar 772 entradas en cada línea del diario lo haría
-- ilegible justo cuando hace falta leerlo.

-- ----------------------------------------------------------------------------
-- 1. ENTRADAS: reemplazo atómico, con testigo de concurrencia y diario
-- ----------------------------------------------------------------------------
create or replace function public.app_content_pool_set_entries(
  p_pool_id text, p_entries jsonb, p_reason text, p_actor uuid,
  p_expected_revision int default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_lifecycle text; v_rev int; v_e jsonb; v_card text; v_w numeric; v_mode text;
  v_n int := 0; v_lifecycle_card text;
  v_antes jsonb; v_altas jsonb; v_bajas jsonb; v_pesos jsonb;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Todo cambio de distribución necesita motivo' using errcode = 'P0001';
  end if;

  select lifecycle, revision into v_lifecycle, v_rev
    from public.content_pools where id = p_pool_id for update;
  if v_lifecycle is null then
    raise exception 'Pool no encontrado: %', p_pool_id using errcode = 'P0001';
  end if;
  if v_lifecycle = 'RETIRED' then
    raise exception 'Un pool RETIRADO no se edita' using errcode = 'P0001';
  end if;

  -- Bajo el cerrojo: aqui ya no hay ventana entre leer y decidir.
  if p_expected_revision is not null and p_expected_revision <> v_rev then
    raise exception 'El pool ha cambiado mientras lo editabas (esperabas r%, hay r%)',
      p_expected_revision, v_rev using errcode = 'P0001';
  end if;

  -- Foto de lo que habia, para poder contar el cambio en el diario.
  select coalesce(jsonb_object_agg(card_id, jsonb_build_array(weight, mode)), '{}'::jsonb)
    into v_antes
    from public.content_pool_entries where pool_id = p_pool_id;

  delete from public.content_pool_entries where pool_id = p_pool_id;

  for v_e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    v_card := v_e->>'card_id';
    v_w    := coalesce((v_e->>'weight')::numeric, 1);
    v_mode := coalesce(v_e->>'mode', 'INCLUDE');

    if v_w <= 0 then
      raise exception 'Peso no válido para %: % (debe ser > 0)', v_card, v_w using errcode = 'P0001';
    end if;

    /*
     * Una carta en DRAFT no puede entrar en un pool ACTIVO: seria repartir contenido que
     * nadie ha aprobado. Se comprueba aqui y NO como restriccion de tabla, porque una carta
     * puede retirarse DESPUES de estar en un pool y bloquear eso impediria retirar cartas.
     * El sorteo, ademas, filtra por ciclo de vida en tiempo de ejecucion (cinturon y
     * tirantes): ver `DROPPABLE_LIFECYCLES` en `server/catalog/rows.ts`.
     */
    select lifecycle into v_lifecycle_card from public.content_cards where card_id = v_card;
    if v_lifecycle_card is null then
      raise exception 'Carta inexistente: %', v_card using errcode = 'P0001';
    end if;
    if v_lifecycle = 'ACTIVE' and v_mode = 'INCLUDE' and v_lifecycle_card <> 'PUBLISHED' then
      raise exception 'La carta % está en % y el pool está ACTIVO: solo entran cartas PUBLISHED',
        v_card, v_lifecycle_card using errcode = 'P0001';
    end if;

    begin
      insert into public.content_pool_entries (pool_id, card_id, weight, mode, note)
      values (p_pool_id, v_card, v_w, v_mode, v_e->>'note');
    exception when unique_violation then
      raise exception 'Entrada duplicada para % en %', v_card, p_pool_id using errcode = 'P0001';
    end;
    v_n := v_n + 1;
  end loop;

  -- Que ha cambiado, en tres listas cortas y legibles.
  select coalesce(jsonb_agg(card_id order by card_id), '[]'::jsonb) into v_altas
    from public.content_pool_entries
   where pool_id = p_pool_id and not (v_antes ? card_id);

  select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_bajas
    from jsonb_object_keys(v_antes) k
   where not exists (select 1 from public.content_pool_entries e
                      where e.pool_id = p_pool_id and e.card_id = k);

  select coalesce(jsonb_object_agg(e.card_id,
           jsonb_build_array((v_antes->e.card_id->>0)::numeric, e.weight)), '{}'::jsonb)
    into v_pesos
    from public.content_pool_entries e
   where e.pool_id = p_pool_id
     and v_antes ? e.card_id
     and (v_antes->e.card_id->>0)::numeric <> e.weight;

  perform public._audit('pool_set_entries', null, p_pool_id, p_actor,
    jsonb_build_object('reason', p_reason, 'total', v_n,
                       'altas', v_altas, 'bajas', v_bajas, 'pesos', v_pesos,
                       'revision', jsonb_build_array(v_rev, v_rev + 1)));

  return jsonb_build_object('poolId', p_pool_id, 'entries', v_n,
                            'version', public._bump_distribution(p_pool_id),
                            'revision', v_rev + 1, 'reason', p_reason);
end; $fn$;

drop function if exists public.app_content_pool_set_entries(text, jsonb, text, uuid);
revoke all on function public.app_content_pool_set_entries(text, jsonb, text, uuid, int) from public, anon, authenticated;
grant execute on function public.app_content_pool_set_entries(text, jsonb, text, uuid, int) to service_role;

-- ----------------------------------------------------------------------------
-- 2. ALTA Y EDICIÓN DEL POOL
-- ----------------------------------------------------------------------------
create or replace function public.app_content_pool_upsert(
  p_pool jsonb, p_reason text, p_actor uuid, p_expected_revision int default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_id text; v_existe boolean; v_lifecycle text; v_rev int;
begin
  v_id := p_pool->>'id';
  if v_id is null or length(btrim(v_id)) = 0 then
    raise exception 'Falta el id del pool' using errcode = 'P0001';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Todo cambio de distribución necesita motivo' using errcode = 'P0001';
  end if;

  select true, lifecycle, revision into v_existe, v_lifecycle, v_rev
    from public.content_pools where id = v_id for update;

  if v_existe is null then
    if p_expected_revision is not null then
      raise exception 'Se esperaba el pool % en la revisión r%, pero no existe',
        v_id, p_expected_revision using errcode = 'P0001';
    end if;
    insert into public.content_pools (id, name, description, mode, rules,
                                      available_from, available_to, season_id, event_id, created_by)
    values (v_id, coalesce(p_pool->>'name', v_id), p_pool->>'description',
            coalesce(p_pool->>'mode', 'RULE'), coalesce(p_pool->'rules', '{}'::jsonb),
            (p_pool->>'available_from')::timestamptz, (p_pool->>'available_to')::timestamptz,
            p_pool->>'season_id', p_pool->>'event_id', p_actor);
    perform public._audit('pool_create', null, v_id, p_actor,
      jsonb_build_object('reason', p_reason, 'mode', coalesce(p_pool->>'mode', 'RULE'),
                         'name', coalesce(p_pool->>'name', v_id)));
  else
    /*
     * Un pool RETIRADO no se edita. Volver a tocar la configuracion de algo que ya esta
     * fuera de circulacion solo puede confundir a quien lea el historico despues; para
     * cambiarlo hay que reactivarlo primero, y eso deja rastro.
     */
    if v_lifecycle = 'RETIRED' then
      raise exception 'Un pool RETIRADO no se edita: reactívalo primero' using errcode = 'P0001';
    end if;
    if p_expected_revision is not null and p_expected_revision <> v_rev then
      raise exception 'El pool ha cambiado mientras lo editabas (esperabas r%, hay r%)',
        p_expected_revision, v_rev using errcode = 'P0001';
    end if;
    update public.content_pools
       set name = coalesce(p_pool->>'name', name),
           description = coalesce(p_pool->>'description', description),
           mode = coalesce(p_pool->>'mode', mode),
           rules = coalesce(p_pool->'rules', rules),
           available_from = coalesce((p_pool->>'available_from')::timestamptz, available_from),
           available_to = coalesce((p_pool->>'available_to')::timestamptz, available_to),
           season_id = coalesce(p_pool->>'season_id', season_id),
           event_id = coalesce(p_pool->>'event_id', event_id)
     where id = v_id;
    perform public._audit('pool_update', null, v_id, p_actor,
      jsonb_build_object('reason', p_reason, 'revision', jsonb_build_array(v_rev, v_rev + 1)));
  end if;

  return jsonb_build_object('poolId', v_id, 'version', public._bump_distribution(v_id),
                            'revision', coalesce(v_rev, 1) + 1,
                            'reason', p_reason, 'actor', p_actor);
end; $fn$;

drop function if exists public.app_content_pool_upsert(jsonb, text, uuid);
revoke all on function public.app_content_pool_upsert(jsonb, text, uuid, int) from public, anon, authenticated;
grant execute on function public.app_content_pool_upsert(jsonb, text, uuid, int) to service_role;

-- ----------------------------------------------------------------------------
-- 3. PUBLICAR / RETIRAR
-- ----------------------------------------------------------------------------
create or replace function public.app_content_pool_publish(
  p_pool_id text, p_state text, p_actor uuid, p_reason text default null,
  p_expected_revision int default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_cur text; v_ok boolean; v_bad int; v_now timestamptz := now(); v_rev int; v_n int;
begin
  select lifecycle, revision into v_cur, v_rev
    from public.content_pools where id = p_pool_id for update;
  if v_cur is null then
    raise exception 'Pool no encontrado: %', p_pool_id using errcode = 'P0001';
  end if;

  if p_expected_revision is not null and p_expected_revision <> v_rev then
    raise exception 'El pool ha cambiado mientras lo editabas (esperabas r%, hay r%)',
      p_expected_revision, v_rev using errcode = 'P0001';
  end if;

  v_ok := case v_cur
    when 'DRAFT'   then p_state in ('ACTIVE')
    when 'ACTIVE'  then p_state in ('RETIRED','DRAFT')
    when 'RETIRED' then p_state in ('ACTIVE')
    else false end;
  if not v_ok then
    raise exception 'Transición ilegal de pool: % → %', v_cur, p_state using errcode = 'P0001';
  end if;

  if p_state = 'ACTIVE' then
    -- Cartas no publicadas dentro de un pool que va a activarse.
    select count(*) into v_bad
      from public.content_pool_entries e
      join public.content_cards c on c.card_id = e.card_id
     where e.pool_id = p_pool_id and e.mode = 'INCLUDE' and c.lifecycle <> 'PUBLISHED';
    if v_bad > 0 then
      raise exception 'No se puede activar %: % entrada(s) apuntan a cartas no publicadas',
        p_pool_id, v_bad using errcode = 'P0001';
    end if;
    -- Un pool EXPLICIT sin entradas no es un pool vacio: es una configuracion que dejaria
    -- un sobre sin nada que entregar. Se rechaza antes de que llegue a un jugador.
    if exists (select 1 from public.content_pools where id = p_pool_id and mode = 'EXPLICIT')
       and not exists (select 1 from public.content_pool_entries
                        where pool_id = p_pool_id and mode = 'INCLUDE') then
      raise exception 'Un pool EXPLICIT sin entradas INCLUDE no se puede activar' using errcode = 'P0001';
    end if;
  end if;

  update public.content_pools
     set lifecycle = p_state,
         published_at = case when p_state = 'ACTIVE'  then coalesce(published_at, v_now) else published_at end,
         retired_at   = case when p_state = 'RETIRED' then v_now
                             when p_state = 'ACTIVE'  then null else retired_at end
   where id = p_pool_id;

  select count(*) into v_n from public.content_pool_entries
   where pool_id = p_pool_id and mode = 'INCLUDE';

  perform public._audit('pool_' || lower(p_state), null, p_pool_id, p_actor,
    jsonb_build_object('from', v_cur, 'to', p_state, 'reason', p_reason,
                       'entries', v_n, 'revision', jsonb_build_array(v_rev, v_rev + 1)));

  return jsonb_build_object('poolId', p_pool_id, 'from', v_cur, 'to', p_state,
                            'revision', v_rev + 1,
                            'version', public._bump_distribution(p_pool_id));
end; $fn$;

drop function if exists public.app_content_pool_publish(text, text, uuid);
revoke all on function public.app_content_pool_publish(text, text, uuid, text, int) from public, anon, authenticated;
grant execute on function public.app_content_pool_publish(text, text, uuid, text, int) to service_role;

-- ----------------------------------------------------------------------------
-- 4. VINCULAR SOBRE ↔ POOL
-- ----------------------------------------------------------------------------
create or replace function public.app_content_pack_bind(
  p_pack_id text, p_pool_id text, p_priority int, p_action text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_antes int;
begin
  if not exists (select 1 from public.content_pools where id = p_pool_id) then
    raise exception 'Pool no encontrado: %', p_pool_id using errcode = 'P0001';
  end if;
  select priority into v_antes from public.content_pack_pools
   where pack_id = p_pack_id and pool_id = p_pool_id;

  if p_action = 'unbind' then
    delete from public.content_pack_pools where pack_id = p_pack_id and pool_id = p_pool_id;
  else
    insert into public.content_pack_pools (pack_id, pool_id, priority)
    values (p_pack_id, p_pool_id, coalesce(p_priority, 100))
    on conflict (pack_id, pool_id) do update set priority = excluded.priority, enabled = true;
  end if;

  perform public._audit('pool_' || coalesce(p_action, 'bind'), null, p_pool_id, p_actor,
    jsonb_build_object('packId', p_pack_id,
                       'priority', jsonb_build_array(v_antes, coalesce(p_priority, 100))));

  return jsonb_build_object('packId', p_pack_id, 'poolId', p_pool_id, 'action', coalesce(p_action, 'bind'),
                            'version', public._bump_distribution(null));
end; $fn$;

revoke all on function public.app_content_pack_bind(text, text, int, text, uuid) from public, anon, authenticated;
grant execute on function public.app_content_pack_bind(text, text, int, text, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 5. EL LISTADO, SIN N+1
-- ----------------------------------------------------------------------------
--
-- El panel enseña, por pool: cuántas cartas, cuánto pesan, cuántas no están publicadas y en
-- qué sobres entra. Con 12 pools eso son 48 consultas si se pregunta pool a pool — y el
-- encargo pide expresamente evitarlo. Una vista lo resuelve en una.
--
-- `v_pool_health` (0039 §7) ya agregaba casi todo esto, pero no trae nombre, estado de
-- publicación ni la lista de sobres, así que el panel tendría que volver a la tabla. Esta la
-- extiende en vez de duplicarla en TypeScript.
create or replace view public.v_pool_admin as
  select p.id, p.name, p.description, p.mode, p.lifecycle, p.revision,
         p.season_id, p.event_id, p.available_from, p.available_to,
         p.created_at, p.updated_at, p.published_at, p.retired_at,
         coalesce(e.includes, 0)                as includes,
         coalesce(e.excludes, 0)                as excludes,
         coalesce(e.peso_total, 0)              as peso_total,
         coalesce(e.no_publicadas, 0)           as no_publicadas,
         coalesce(e.retiradas, 0)               as retiradas,
         coalesce(pk.packs, '{}'::text[])       as packs,
         coalesce(pk.n_packs, 0)                as n_packs
    from public.content_pools p
    left join lateral (
      select count(*) filter (where e.mode = 'INCLUDE')                              as includes,
             count(*) filter (where e.mode = 'EXCLUDE')                              as excludes,
             coalesce(sum(e.weight) filter (where e.mode = 'INCLUDE'), 0)            as peso_total,
             count(*) filter (where e.mode = 'INCLUDE' and c.lifecycle = 'DRAFT')    as no_publicadas,
             count(*) filter (where e.mode = 'INCLUDE' and c.lifecycle = 'RETIRED')  as retiradas
        from public.content_pool_entries e
        join public.content_cards c on c.card_id = e.card_id
       where e.pool_id = p.id
    ) e on true
    left join lateral (
      select array_agg(pp.pack_id order by pp.priority, pp.pack_id) as packs,
             count(*)                                              as n_packs
        from public.content_pack_pools pp
       where pp.pool_id = p.id and pp.enabled
    ) pk on true;

alter view public.v_pool_admin set (security_invoker = true);
revoke all on public.v_pool_admin from anon, authenticated;
grant select on public.v_pool_admin to service_role;

comment on view public.v_pool_admin is
  'Bloque 8.4.3 - una fila por pool con todo lo que el listado del panel necesita. Existe '
  'para que enseñar 12 pools cueste UNA consulta y no 48.';

-- ----------------------------------------------------------------------------
-- 6. UNA ENTRADA, ATÓMICAMENTE
-- ----------------------------------------------------------------------------
--
-- 8.3 decidió que las entradas se fijaran TODAS DE GOLPE, y el razonamiento era bueno: «una
-- secuencia de operaciones parciales tiene estados intermedios observables, y el estado
-- intermedio de un pool es una distribución de probabilidad que nadie quiso publicar».
--
-- Ese razonamiento sigue en pie para una SECUENCIA. No para una operación suelta: añadir una
-- carta dentro de una única transacción que además sube la revisión y la versión de la
-- distribución no tiene ningún estado intermedio que nadie pueda observar.
--
-- Y hace falta, porque el panel pagina. Un pool real tiene 772 entradas; la ficha enseña 25.
-- Si cambiar un peso obligara a reenviar «todas» las entradas, el navegador enviaría las 25
-- que tiene cargadas y `set_entries` **borraría las otras 747**. Es la clase de trampa que se
-- descubre en producción, así que la puerta se cierra dando la operación correcta en vez de
-- confiar en que nadie la pise.
--
-- `set_entries` se conserva intacta: sigue siendo la forma de sustituir una configuración
-- entera de una vez, que es lo que hace el migrador.

create or replace function public.app_content_pool_entry_upsert(
  p_pool_id text, p_card_id text, p_weight numeric, p_mode text,
  p_note text, p_reason text, p_actor uuid, p_expected_revision int default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_lifecycle text; v_rev int; v_card text; v_antes numeric; v_modo_antes text;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Todo cambio de distribución necesita motivo' using errcode = 'P0001';
  end if;
  if p_weight is null or p_weight <= 0 or p_weight > 1000000 then
    raise exception 'Peso no válido para %: % (debe ser > 0 y <= 1000000)', p_card_id, p_weight
      using errcode = 'P0001';
  end if;
  if coalesce(p_mode, 'INCLUDE') not in ('INCLUDE', 'EXCLUDE') then
    raise exception 'Modo no válido: %', p_mode using errcode = 'P0001';
  end if;

  select lifecycle, revision into v_lifecycle, v_rev
    from public.content_pools where id = p_pool_id for update;
  if v_lifecycle is null then
    raise exception 'Pool no encontrado: %', p_pool_id using errcode = 'P0001';
  end if;
  if v_lifecycle = 'RETIRED' then
    raise exception 'Un pool RETIRADO no se edita' using errcode = 'P0001';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_rev then
    raise exception 'El pool ha cambiado mientras lo editabas (esperabas r%, hay r%)',
      p_expected_revision, v_rev using errcode = 'P0001';
  end if;

  select lifecycle into v_card from public.content_cards where card_id = p_card_id;
  if v_card is null then
    raise exception 'Carta inexistente: %', p_card_id using errcode = 'P0001';
  end if;
  -- Misma regla que `set_entries`: en un pool ACTIVO solo entran cartas PUBLISHED. Una carta
  -- que se retira DESPUES se queda donde esta -- por eso no es una restriccion de tabla.
  if v_lifecycle = 'ACTIVE' and coalesce(p_mode,'INCLUDE') = 'INCLUDE' and v_card <> 'PUBLISHED' then
    raise exception 'La carta % está en % y el pool está ACTIVO: solo entran cartas PUBLISHED',
      p_card_id, v_card using errcode = 'P0001';
  end if;

  select weight, mode into v_antes, v_modo_antes from public.content_pool_entries
   where pool_id = p_pool_id and card_id = p_card_id;

  insert into public.content_pool_entries (pool_id, card_id, weight, mode, note)
  values (p_pool_id, p_card_id, p_weight, coalesce(p_mode, 'INCLUDE'), p_note)
  on conflict (pool_id, card_id) do update
    set weight = excluded.weight, mode = excluded.mode,
        note = excluded.note, updated_at = now();

  perform public._audit(
    case when v_antes is null then 'pool_entry_add' else 'pool_entry_update' end,
    p_card_id, p_pool_id, p_actor,
    jsonb_build_object('reason', p_reason,
                       'weight', jsonb_build_array(v_antes, p_weight),
                       'mode', jsonb_build_array(v_modo_antes, coalesce(p_mode, 'INCLUDE')),
                       'revision', jsonb_build_array(v_rev, v_rev + 1)));

  return jsonb_build_object('poolId', p_pool_id, 'cardId', p_card_id,
                            'weight', p_weight, 'mode', coalesce(p_mode, 'INCLUDE'),
                            'nueva', v_antes is null,
                            'revision', v_rev + 1,
                            'version', public._bump_distribution(p_pool_id));
end; $fn$;

create or replace function public.app_content_pool_entry_remove(
  p_pool_id text, p_card_id text, p_reason text, p_actor uuid,
  p_expected_revision int default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_lifecycle text; v_rev int; v_w numeric; v_mode text; v_quedan int;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Todo cambio de distribución necesita motivo' using errcode = 'P0001';
  end if;

  select lifecycle, revision into v_lifecycle, v_rev
    from public.content_pools where id = p_pool_id for update;
  if v_lifecycle is null then
    raise exception 'Pool no encontrado: %', p_pool_id using errcode = 'P0001';
  end if;
  if v_lifecycle = 'RETIRED' then
    raise exception 'Un pool RETIRADO no se edita' using errcode = 'P0001';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v_rev then
    raise exception 'El pool ha cambiado mientras lo editabas (esperabas r%, hay r%)',
      p_expected_revision, v_rev using errcode = 'P0001';
  end if;

  select weight, mode into v_w, v_mode from public.content_pool_entries
   where pool_id = p_pool_id and card_id = p_card_id;
  if v_w is null then
    raise exception 'La carta % no está en el pool %', p_card_id, p_pool_id using errcode = 'P0001';
  end if;

  /*
   * Un pool EXPLICIT ACTIVO no puede quedarse sin cartas: seria dejar un sobre sin nada que
   * entregar. `app_content_pool_publish` ya lo impide al activar; aqui se impide tambien al
   * vaciar, porque si no, la misma configuracion prohibida se alcanza por el otro lado.
   */
  select count(*) into v_quedan from public.content_pool_entries
   where pool_id = p_pool_id and mode = 'INCLUDE' and card_id <> p_card_id;
  if v_lifecycle = 'ACTIVE' and v_mode = 'INCLUDE' and v_quedan = 0
     and exists (select 1 from public.content_pools where id = p_pool_id and mode = 'EXPLICIT') then
    raise exception 'Es la última carta de un pool EXPLICIT ACTIVO: el sobre se quedaría sin nada que entregar'
      using errcode = 'P0001';
  end if;

  delete from public.content_pool_entries where pool_id = p_pool_id and card_id = p_card_id;

  perform public._audit('pool_entry_remove', p_card_id, p_pool_id, p_actor,
    jsonb_build_object('reason', p_reason, 'weight', v_w, 'mode', v_mode,
                       'revision', jsonb_build_array(v_rev, v_rev + 1)));

  return jsonb_build_object('poolId', p_pool_id, 'cardId', p_card_id, 'quedan', v_quedan,
                            'revision', v_rev + 1,
                            'version', public._bump_distribution(p_pool_id));
end; $fn$;

revoke all on function public.app_content_pool_entry_upsert(text, text, numeric, text, text, text, uuid, int) from public, anon, authenticated;
revoke all on function public.app_content_pool_entry_remove(text, text, text, uuid, int) from public, anon, authenticated;
grant execute on function public.app_content_pool_entry_upsert(text, text, numeric, text, text, text, uuid, int) to service_role;
grant execute on function public.app_content_pool_entry_remove(text, text, text, uuid, int) to service_role;
