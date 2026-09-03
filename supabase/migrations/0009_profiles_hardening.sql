-- ============================================================================
-- SEC-02 · BLINDAJE DE public.profiles  (Auditoría Fase A)
--
-- PROBLEMA
--   `0001_init.sql:96` creaba:
--       create policy "edita tu perfil" on public.profiles
--         for update using (auth.uid() = id);
--   Sin `with check` y, sobre todo, SIN privilegios de columna. RLS en Postgres
--   filtra FILAS, nunca COLUMNAS: la política dejaba que un usuario autenticado
--   hiciera UPDATE de CUALQUIER campo de su propia fila. Incluidos:
--       credits · tokens · xp · level · collection_value · distinct_cards
--       rarest_rank · market_volume · packs_opened · taxes_paid · is_admin
--   Es decir: saldo infinito, ranking falsificado y ESCALADA A ADMINISTRADOR
--   (`is_admin`, añadido en 0006), que a su vez abre /api/admin/* (service_role).
--
-- SOLUCIÓN (tres capas independientes; si una falla, las otras aguantan)
--   1. Privilegios de COLUMNA: se revoca UPDATE global y solo se concede sobre
--      (username, avatar). Es el mecanismo nativo y el que de verdad corta.
--   2. `with check` en la política: el usuario no puede reasignar su fila a otro.
--   3. Trigger guardián: rechaza cambios en columnas protegidas si el rol que
--      ejecuta la sentencia es `authenticated`/`anon`. Cubre el caso de que
--      alguien vuelva a conceder privilegios por error en el futuro.
--
-- QUÉ SIGUE FUNCIONANDO (comprobado contra el código de la app)
--   · `handle_new_user()` — SECURITY DEFINER, corre como el owner → INSERT ok.
--   · `/cuenta` cambia el avatar (`src/app/cuenta/page.tsx:22`) → UPDATE ok.
--   · `buy_listing()` / `market_on_transaction()` mueven `credits` y
--     `market_volume` — son SECURITY DEFINER (owner) → siguen pudiendo.
--   · Las rutas admin y los scripts de sync usan `service_role` → siguen pudiendo.
--   · El trigger `profiles_touch` escribe `updated_at` desde un BEFORE trigger:
--     Postgres comprueba los privilegios de columna contra el SET de la
--     sentencia, no contra lo que toquen los triggers → no hace falta conceder
--     `updated_at`.
--
-- NOTA DE ALCANCE (Fase A): esto corta la ESCRITURA. La LECTURA de `profiles`
-- sigue siendo pública por diseño (los rankings dependen de ella), lo que expone
-- `credits` e `is_admin` de todos los usuarios. Reducir la superficie de lectura
-- exige separar perfil público de perfil privado → DIFERIDO A FASE B.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PRIVILEGIOS DE COLUMNA — la capa que realmente corta el vector
-- ----------------------------------------------------------------------------
-- Se revoca el UPDATE de tabla completa para los roles que usan los clientes.
revoke update on public.profiles from anon;
revoke update on public.profiles from authenticated;

-- Y se devuelve SOLO lo que el usuario debe poder editar de su propio perfil.
grant update (username, avatar) on public.profiles to authenticated;

-- El backend (rutas admin, cron de sync, RPC) conserva el acceso completo.
grant update on public.profiles to service_role;

-- ----------------------------------------------------------------------------
-- 2. POLÍTICA RLS — misma fila, ahora también en la comprobación de destino
-- ----------------------------------------------------------------------------
drop policy if exists "edita tu perfil" on public.profiles;
create policy "edita tu perfil" on public.profiles
  for update
  using      (auth.uid() = id)
  with check (auth.uid() = id);

-- ----------------------------------------------------------------------------
-- 3. TRIGGER GUARDIÁN — defensa en profundidad sobre columnas sensibles
-- ----------------------------------------------------------------------------
-- Solo actúa cuando la sentencia la ejecuta un rol de cliente. Las funciones
-- SECURITY DEFINER (market, handle_new_user) corren como el owner y las rutas
-- de servidor como `service_role`, así que ninguna se ve afectada.
create or replace function public.profiles_guard_protected_columns()
returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new; -- backend / SECURITY DEFINER: sin restricción
  end if;

  if new.id               is distinct from old.id               then raise exception 'SEC-02: id no es editable'; end if;
  if new.credits          is distinct from old.credits          then raise exception 'SEC-02: credits solo lo modifica el servidor'; end if;
  if new.tokens           is distinct from old.tokens           then raise exception 'SEC-02: tokens solo lo modifica el servidor'; end if;
  if new.xp               is distinct from old.xp               then raise exception 'SEC-02: xp solo lo modifica el servidor'; end if;
  if new.level            is distinct from old.level            then raise exception 'SEC-02: level solo lo modifica el servidor'; end if;
  if new.collection_value is distinct from old.collection_value then raise exception 'SEC-02: collection_value solo lo modifica el servidor'; end if;
  if new.distinct_cards   is distinct from old.distinct_cards   then raise exception 'SEC-02: distinct_cards solo lo modifica el servidor'; end if;
  if new.rarest_rank      is distinct from old.rarest_rank      then raise exception 'SEC-02: rarest_rank solo lo modifica el servidor'; end if;
  if new.market_volume    is distinct from old.market_volume    then raise exception 'SEC-02: market_volume solo lo modifica el servidor'; end if;
  if new.packs_opened     is distinct from old.packs_opened     then raise exception 'SEC-02: packs_opened solo lo modifica el servidor'; end if;
  if new.taxes_paid       is distinct from old.taxes_paid       then raise exception 'SEC-02: taxes_paid solo lo modifica el servidor'; end if;
  if new.is_admin         is distinct from old.is_admin         then raise exception 'SEC-02: is_admin solo lo modifica el servidor'; end if;
  if new.created_at       is distinct from old.created_at       then raise exception 'SEC-02: created_at no es editable'; end if;

  return new;
end; $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard_protected_columns();
