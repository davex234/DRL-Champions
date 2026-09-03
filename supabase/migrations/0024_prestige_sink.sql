-- ============================================================================
-- FASE 14 · PRESTIGIO: EL PRIMER SUMIDERO DE CRÉDITOS QUE NO ES UN SOBRE
--
-- ────────────────────────── EL PROBLEMA, MEDIDO ──────────────────────────
--
-- Hasta hoy la economía de NEXUS tenía **un solo sumidero**: comprar sobres. (La comisión
-- del mercado es el otro, y el mercado está cerrado.) Eso lo dejó escrito la Fase 11, lo
-- confirmó la 12 y la 13 lo dejó como su único pendiente.
--
-- La Fase 14 lo ha medido con el escenario de saturación de `npm run economy:simulate`:
--
--   Casual      62 % de colección →       274 créditos acumulados (3/día)
--   Activo      57 %              →       758                     (9/día)
--   Intensivo   85 %              →   167.582                 (1.995/día)
--
-- Solo un perfil se satura, y acumula unos 2.000 créditos al día sin destino. Ese es el
-- caudal exacto que hay que absorber.
--
-- ────────────────────────── QUÉ AÑADE ESTA MIGRACIÓN ──────────────────────────
--
-- Una función, `app_buy_cosmetic`. **Ninguna tabla.**
--
-- El prestigio es la mejora visual de una insignia de maestría que ya te has ganado
-- coleccionando: plata (15.000), oro (40.000), élite (100.000). Se paga en DRL Credits, no
-- da ninguna ventaja y no devuelve nada a la economía.
--
--   · `user_cosmetics` ya guarda cosméticos poseídos, con `source` y `granted_at`.
--   · `_ledger_apply` ya es la única puerta que escribe `profiles.credits` (Fase 11).
--   · `economy_ops` ya guarda el resultado de una operación para poder reintentarla.
--   · `app_equip_cosmetic` ya sabe equipar cualquier id cuya familia coincida.
--
-- Lo único que faltaba era la operación que **cobra y concede en la misma transacción**.
--
-- ────────────────────────── LAS CUATRO PUERTAS ──────────────────────────
--
--   1. IDEMPOTENCIA   `economy_ops[ref]` — un reintento devuelve lo mismo y no cobra dos veces.
--   2. NO DUPLICAR    si ya tiene el cosmético, no se cobra. Cobrar por algo que ya es tuyo
--                     es la peor clase de fallo económico: el jugador no lo nota hasta que
--                     mira el saldo.
--   3. REQUISITO      hay que tener el escalón anterior (y, en el primero, la insignia base
--                     que se ganó completando el conjunto). **Los créditos no sustituyen a
--                     coleccionar: lo reconocen.**
--   4. SALDO          `_ledger_apply` corta si no llega, y deshace la transacción entera.
--
-- El orden importa: se comprueba TODO antes de tocar el saldo, para que un rechazo no deje
-- ni un asiento a medias.
-- ============================================================================

create or replace function public.app_buy_cosmetic(
  p_user uuid,
  p_cosmetic_id text,
  p_price bigint,
  p_requires text,
  p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_balance bigint; v_prev jsonb;
begin
  if p_price <= 0 then raise exception 'Precio inválido' using errcode = 'P0001'; end if;
  if p_cosmetic_id is null or length(p_cosmetic_id) = 0 then
    raise exception 'Falta el cosmético' using errcode = 'P0001';
  end if;
  if p_ref is null or length(p_ref) = 0 then
    raise exception 'Una compra necesita clave de idempotencia' using errcode = 'P0001';
  end if;

  -- 1 · Repetición: lo mismo que la primera vez, sin cobrar de nuevo.
  select result into v_prev from public.economy_ops where ref = p_ref;
  if v_prev is not null then return v_prev || jsonb_build_object('repeated', true); end if;

  -- 2 · Ya es suyo: no se cobra.
  if exists (
    select 1 from public.user_cosmetics
     where user_id = p_user and cosmetic_id = p_cosmetic_id
  ) then
    raise exception 'Ya tienes ese cosmético' using errcode = 'P0001';
  end if;

  -- 3 · El requisito. Es lo que impide comprar prestigio sin haber coleccionado.
  if p_requires is not null and length(p_requires) > 0 then
    if not exists (
      select 1 from public.user_cosmetics
       where user_id = p_user and cosmetic_id = p_requires
    ) then
      raise exception 'Te falta el escalón anterior' using errcode = 'P0001';
    end if;
  end if;

  -- 4 · Y solo ahora, el dinero. Corta y deshace si no llega.
  v_balance := public._ledger_apply(
    p_user, -p_price, 'prestige:' || p_cosmetic_id, p_ref, 'debit');

  insert into public.user_cosmetics (user_id, cosmetic_id, source)
  values (p_user, p_cosmetic_id, 'prestige');

  v_prev := jsonb_build_object(
    'credits', v_balance, 'cosmeticId', p_cosmetic_id, 'price', p_price);
  insert into public.economy_ops (ref, user_id, kind, result)
  values (p_ref, p_user, 'buy_cosmetic', v_prev);
  return v_prev;
end; $$;

-- Cerrada al navegador, como todas. Solo la llama el servidor con la clave de servicio.
revoke all on function public.app_buy_cosmetic(uuid, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.app_buy_cosmetic(uuid, text, bigint, text, text) to service_role;

comment on function public.app_buy_cosmetic(uuid, text, bigint, text, text) is
  'Fase 14: compra un cosmetico de prestigio. Cobra por _ledger_apply y concede en la misma transaccion. Sumidero puro: no devuelve creditos.';
