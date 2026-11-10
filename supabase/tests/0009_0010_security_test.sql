-- ============================================================================
-- TEST DE SEGURIDAD — SEC-02 (profiles) + SEC-01 (deposit_card)
--
-- CÓMO EJECUTARLO
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0009_0010_security_test.sql
--   …o pegarlo entero en el SQL Editor de Supabase.
--
--   Requiere que 0009_profiles_hardening.sql y 0010_market_lockdown.sql estén aplicadas.
--
-- QUÉ HACE
--   Crea un usuario de prueba, se hace pasar por él (rol `authenticated` + claim `sub`,
--   exactamente como PostgREST) y comprueba 16 invariantes: 12 negativos (lo que el
--   cliente ya NO puede hacer) y 4 positivos (lo que TIENE que seguir funcionando, para
--   no dar por bueno un blindaje que rompa el juego). Todo va dentro de una transacción
--   que termina en ROLLBACK: no deja rastro en la base de datos.
--
-- CÓMO SE LEE EL RESULTADO
--   Termina imprimiendo "TODAS LAS COMPROBACIONES PASAN".
--   Si algo falla, aborta con el mensaje del invariante incumplido.
-- ============================================================================

begin;

-- ── Preparación: usuario y perfil de prueba ─────────────────────────────────
do $$
declare v_uid uuid := '00000000-0000-4000-8000-0000000ce511';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'sec-test@example.invalid', '', now(), now())
  on conflict (id) do nothing;

  -- `handle_new_user` puede haber creado ya el perfil; si no, se crea aquí.
  insert into public.profiles (id, username, avatar)
  values (v_uid, 'sec_test_user', '🎮')
  on conflict (id) do nothing;

  -- Valores conocidos de partida (como owner, sin restricciones).
  update public.profiles
     set credits = 1000, xp = 100, level = 2,
         collection_value = 500, distinct_cards = 5, rarest_rank = 3,
         market_volume = 50, packs_opened = 7, is_admin = false
   where id = v_uid;
end $$;

-- ── Nos convertimos en ESE usuario, igual que hace PostgREST ────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000ce511","role":"authenticated"}';

-- ── 1 · POSITIVO: el usuario SÍ puede editar username y avatar ──────────────
do $$
declare v_uid uuid := '00000000-0000-4000-8000-0000000ce511';
begin
  update public.profiles set avatar = '🦊', username = 'sec_test_renombrado' where id = v_uid;
  if not found then
    raise exception 'FALLO 1: el usuario no ha podido editar su propio username/avatar';
  end if;
  raise notice '  OK  1 · username y avatar siguen siendo editables';
end $$;

-- ── 2-10 · NEGATIVOS: columnas protegidas ──────────────────────────────────
-- Cada bloque intenta el UPDATE y espera que la base de datos lo rechace, ya sea por
-- privilegio de columna (42501, migración 0009 §1) o por el trigger guardián (§3).
do $$
declare
  v_uid uuid := '00000000-0000-4000-8000-0000000ce511';
  v_col text;
  v_blocked boolean;
  v_cols text[] := array[
    'credits', 'xp', 'level',
    'collection_value', 'rarest_rank', 'market_volume', 'distinct_cards', 'packs_opened'
  ];
begin
  foreach v_col in array v_cols loop
    v_blocked := false;
    begin
      execute format('update public.profiles set %I = %I + 1 where id = $1', v_col, v_col) using v_uid;
    exception when others then
      v_blocked := true;
    end;
    if not v_blocked then
      raise exception 'FALLO: la columna protegida % sigue siendo escribible por authenticated', v_col;
    end if;
    raise notice '  OK  · % NO es escribible por el cliente', v_col;
  end loop;
end $$;

-- ── 11 · NEGATIVO CRÍTICO: escalada de privilegios vía is_admin ─────────────
do $$
declare
  v_uid uuid := '00000000-0000-4000-8000-0000000ce511';
  v_blocked boolean := false;
  v_is_admin boolean;
begin
  begin
    update public.profiles set is_admin = true where id = v_uid;
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FALLO CRÍTICO: un usuario normal ha podido asignarse is_admin';
  end if;

  -- Y comprobación de efecto: el valor sigue siendo false.
  select is_admin into v_is_admin from public.profiles where id = v_uid;
  if v_is_admin then
    raise exception 'FALLO CRÍTICO: is_admin quedó a true';
  end if;
  raise notice '  OK  11 · is_admin NO es autoasignable (sin escalada a administrador)';
end $$;

-- ── 12 · NEGATIVO: no se puede editar el perfil de OTRO usuario ─────────────
-- OJO con la estructura: el `raise` de fallo NO puede ir dentro del bloque que tiene
-- el manejador de excepciones, o el propio manejador se lo tragaría y el test daría
-- verde estando roto. Se recoge el nº de filas y se decide FUERA.
do $$
declare v_rows int := 0;
begin
  begin
    update public.profiles set avatar = '💀' where id <> '00000000-0000-4000-8000-0000000ce511';
    get diagnostics v_rows = row_count;
  exception when others then
    v_rows := 0; -- rechazado por privilegios: también es aislamiento correcto
  end;

  if v_rows > 0 then
    raise exception 'FALLO: se han modificado % filas de perfiles de otros usuarios', v_rows;
  end if;
  raise notice '  OK  12 · RLS aísla el perfil de otros usuarios';
end $$;

-- ── 13 · SEC-01: deposit_card no es invocable por el cliente ────────────────
do $$
declare v_blocked boolean := false;
begin
  begin
    perform public.deposit_card('derke__champions-mvp', 1);
  exception when insufficient_privilege then
    -- 42501 "permission denied for function": es exactamente lo que queremos.
    v_blocked := true;
  when others then
    -- Cualquier otro error es inesperado: la función llegó a ejecutarse.
    v_blocked := false;
  end;
  if not v_blocked then
    raise exception 'FALLO CRÍTICO SEC-01: deposit_card sigue acuñando cartas arbitrarias';
  end if;
  raise notice '  OK  13 · deposit_card rechaza al rol authenticated (SEC-01)';
end $$;

-- ── 14 · Las RPC que mueven valor tampoco son invocables ────────────────────
do $$
declare
  v_fn text;
  v_blocked boolean;
  v_calls text[] := array[
    -- Los NULL van casteados: sin tipo, Postgres no puede resolver la sobrecarga
    -- y fallaría por ambigüedad en vez de por privilegios, falseando el test.
    'select public.create_listing(''x__gold'', null::int, 100)',
    'select public.buy_listing(''00000000-0000-4000-8000-000000000001''::uuid)',
    'select public.make_offer(''card'', ''x__gold'', null::int, null::uuid, 100::bigint)',
    'select public.accept_offer(''00000000-0000-4000-8000-000000000001''::uuid)'
  ];
begin
  foreach v_fn in array v_calls loop
    v_blocked := false;
    begin
      execute v_fn;
    exception when insufficient_privilege then
      v_blocked := true;
    when others then
      v_blocked := false; -- llegó a ejecutarse: el EXECUTE no está revocado
    end;
    if not v_blocked then
      raise exception 'FALLO: la RPC de mercado sigue concedida a authenticated → %', v_fn;
    end if;
  end loop;
  raise notice '  OK  14 · create_listing / buy_listing / make_offer / accept_offer revocadas';
end $$;

-- ── 15 · POSITIVO: la ruta de RECUPERACIÓN sigue disponible para el cliente ─
-- `cancel_offer` y `cancel_listing` se dejaron concedidas a propósito: no acuñan,
-- solo devuelven o reembolsan, y sin ellas un usuario con listados vivos quedaría
-- atrapado. Debe fallar por "Oferta inexistente" (llega a ejecutarse), NUNCA por
-- privilegios — eso indicaría que el cierre se pasó de frenada.
do $$
declare v_msg text;
begin
  begin
    perform public.cancel_offer('00000000-0000-4000-8000-00000000dead'::uuid);
    raise exception 'FALLO 15: cancel_offer no debería haber encontrado esa oferta';
  exception
    when insufficient_privilege then
      raise exception 'FALLO 15: cancel_offer bloqueada por privilegios (cierre demasiado amplio)';
    when others then
      get stacked diagnostics v_msg = message_text;
      if v_msg not like '%Oferta inexistente%' then raise; end if;
  end;
  raise notice '  OK  15 · cancel_offer sigue siendo invocable (ruta de recuperación intacta)';
end $$;

reset role;

-- ── 16 · POSITIVO: el BACKEND legítimo sigue pudiendo escribir ──────────────
-- El blindaje solo debe morder a los roles de cliente. Las rutas admin
-- (service_role) y las RPC SECURITY DEFINER tienen que seguir operando, o
-- habríamos roto el juego además de cerrarlo.
do $$
declare
  v_uid uuid := '00000000-0000-4000-8000-0000000ce511';
  v_credits bigint; v_admin boolean;
begin
  update public.profiles
     set credits = credits + 500, xp = xp + 50, is_admin = true
   where id = v_uid;

  select credits, is_admin into v_credits, v_admin from public.profiles where id = v_uid;
  if v_credits <> 1500 then
    raise exception 'FALLO 16: el backend no ha podido actualizar credits (valor: %)', v_credits;
  end if;
  if not v_admin then
    raise exception 'FALLO 16: el backend no ha podido conceder is_admin';
  end if;
  raise notice '  OK  16 · el backend (owner/service_role) conserva la escritura completa';
end $$;

do $$ begin raise notice '';
            raise notice '✅ TODAS LAS COMPROBACIONES PASAN (SEC-01 + SEC-02)'; end $$;

-- No dejamos rastro: el usuario y los cambios de prueba se descartan.
rollback;
