-- ============================================================================
-- TEST DE SEGURIDAD — 0015 (region competitiva, Fase 9D)
--
-- CÓMO EJECUTARLO
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0015_rank_region_test.sql
--
--   Requiere 0009_profiles_hardening.sql y 0015_rank_region.sql aplicadas.
--
-- POR QUÉ EXISTE
--   La Fase 9D concede a `authenticated` un privilegio de escritura NUEVO sobre
--   `profiles` (`grant update (region)`). Cada vez que se abre una columna al cliente
--   hay que demostrar dos cosas: que la nueva se puede escribir Y que no se ha abierto
--   ninguna otra de paso. Ese es exactamente el vector que cerró SEC-02.
--
--   Se comprueban 6 invariantes: 2 positivos y 4 negativos. Todo dentro de una
--   transacción que acaba en ROLLBACK: no deja rastro.
-- ============================================================================

begin;

-- ── Preparación: usuario y perfil de prueba ─────────────────────────────────
do $$
declare v_uid uuid := '00000000-0000-4000-8000-0000000ce512';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'rank-region-test@example.invalid', '', now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, username)
  values (v_uid, 'rank_region_test')
  on conflict (id) do nothing;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000ce512","role":"authenticated"}';

-- ── 1 · POSITIVO: el usuario puede declarar su región ───────────────────────
do $$
declare
  v_uid uuid := '00000000-0000-4000-8000-0000000ce512';
  v_region text;
begin
  update public.profiles set region = 'EMEA' where id = v_uid;
  select region into v_region from public.profiles where id = v_uid;
  if v_region is distinct from 'EMEA' then
    raise exception 'FALLO 1: el usuario no ha podido declarar su región';
  end if;
  raise notice '  OK  1 · el usuario puede declarar su región';
end $$;

-- ── 2 · POSITIVO: puede retirarla (volver a NULL) ───────────────────────────
do $$
declare
  v_uid uuid := '00000000-0000-4000-8000-0000000ce512';
  v_region text;
begin
  update public.profiles set region = null where id = v_uid;
  select region into v_region from public.profiles where id = v_uid;
  if v_region is not null then
    raise exception 'FALLO 2: la región no se puede retirar';
  end if;
  update public.profiles set region = 'EMEA' where id = v_uid; -- se deja declarada
  raise notice '  OK  2 · la región se puede retirar (NULL es un valor válido)';
end $$;

-- ── 3 · NEGATIVO: una región inventada la rechaza el CHECK ──────────────────
do $$
declare
  v_uid uuid := '00000000-0000-4000-8000-0000000ce512';
  v_blocked boolean := false;
begin
  begin
    update public.profiles set region = 'Marte' where id = v_uid;
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FALLO 3: se ha aceptado una región fuera del circuito';
  end if;
  raise notice '  OK  3 · solo se aceptan las cuatro regiones del circuito';
end $$;

-- ── 4 · NEGATIVO: no se puede tocar la región de OTRO ───────────────────────
do $$
declare v_touched int;
begin
  update public.profiles set region = 'China'
   where id <> '00000000-0000-4000-8000-0000000ce512';
  get diagnostics v_touched = row_count;
  if v_touched > 0 then
    raise exception 'FALLO 4: se ha podido cambiar la región de % perfiles ajenos', v_touched;
  end if;
  raise notice '  OK  4 · RLS sigue acotando el UPDATE a la propia fila';
end $$;

-- ── 5 · NEGATIVO CRÍTICO: la nueva concesión NO abre `points` ───────────────
-- `points` decide el rango y la clasificación entera. Si se pudiera escribir desde el
-- cliente, todo el sistema competitivo de la Fase 9D sería decorativo.
do $$
declare
  v_uid uuid := '00000000-0000-4000-8000-0000000ce512';
  v_blocked boolean := false;
  v_points int;
begin
  begin
    update public.profiles set points = 999999 where id = v_uid;
  exception when others then
    v_blocked := true;
  end;
  select points into v_points from public.profiles where id = v_uid;
  if not v_blocked or v_points = 999999 then
    raise exception 'FALLO 5: `points` es escribible por el cliente (rango falsificable)';
  end if;
  raise notice '  OK  5 · `points` sigue siendo solo del servidor';
end $$;

-- ── 6 · NEGATIVO: tampoco se cuela otra columna en el mismo UPDATE ──────────
-- Un UPDATE con dos columnas se comprueba entero: si una está prohibida, cae todo.
do $$
declare
  v_uid uuid := '00000000-0000-4000-8000-0000000ce512';
  v_blocked boolean := false;
  v_credits bigint;
begin
  begin
    update public.profiles set region = 'Pacific', credits = credits + 100000 where id = v_uid;
  exception when others then
    v_blocked := true;
  end;
  select credits into v_credits from public.profiles where id = v_uid;
  if not v_blocked then
    raise exception 'FALLO 6: se ha colado `credits` acompañando a `region`';
  end if;
  raise notice '  OK  6 · acompañar `region` de una columna protegida no la desbloquea (saldo: %)', v_credits;
end $$;

reset role;
rollback;

\echo '✅ 0015 · TODAS LAS COMPROBACIONES PASAN'
