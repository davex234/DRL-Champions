-- ============================================================================
-- SEC-01 + BUG-01/02/06 · CIERRE DEL MERCADO GLOBAL  (Auditoría Fase A)
--
-- PROBLEMA RAÍZ (SEC-01)
--   `0001_init.sql:150` — deposit_card(p_card_id text, p_serial int) es
--   SECURITY DEFINER y su única comprobación es `auth.uid() is not null`.
--   Inserta en `public.inventory` los parámetros que le pasen SIN verificar
--   que el usuario posea esa carta: la posesión vive en el localStorage del
--   cliente y el servidor no la conoce. Cualquiera con sesión puede acuñar
--   cartas arbitrarias desde la consola del navegador:
--       supabase.rpc('deposit_card', {p_card_id:'derke__champions-mvp', p_serial:1})
--   y venderlas después por créditos reales a otros jugadores.
--
--   No es un fallo de la función: es que NO EXISTE una fuente de verdad de
--   propiedad en el servidor contra la que validar. Arreglarlo de verdad es
--   construir el inventario server-authoritative → DIFERIDO A FASE B.
--
-- MITIGACIÓN DE FASE A (esta migración)
--   Quitar el mercado global de las manos del cliente, sin borrar nada:
--   se revoca EXECUTE a `anon`/`authenticated` sobre las RPC que ACUÑAN o
--   MUEVEN valor. Las funciones, el esquema, los índices y todo el antifraude
--   de 0004 (banda de precio, rate limit, wash-trading, impuestos) quedan
--   INTACTOS y se vuelven a conceder en Fase E, ya sobre un inventario real.
--
--   Queda seguro aunque el usuario conozca el nombre de la RPC: PostgREST
--   responde 403 (permission denied for function) antes de ejecutar nada.
--
-- QUÉ SE REVOCA Y POR QUÉ
--   deposit_card    → es el vector de acuñación (SEC-01).
--   create_listing  → publicar exige depósito previo; sin él no tiene sentido,
--                     y cerrarlo rompe el bucle de duplicación (BUG-02).
--   buy_listing     → compra que el cliente "reembolsa" vía pushState (BUG-01).
--   make_offer      → mueve créditos en escrow.
--   accept_offer    → transfiere propiedad y créditos.
--
-- QUÉ SE MANTIENE, DELIBERADAMENTE
--   cancel_listing / cancel_offer → rutas de RECUPERACIÓN. No acuñan: devuelven
--     al inventario o reembolsan. Si una base de datos ya tiene listados u
--     ofertas vivas, el usuario debe poder recuperarlos. Sin create_listing
--     concedido, el bucle publicar→cancelar de BUG-02 ya no se puede cerrar.
--   search_listings → solo lectura, sin efectos.
--   market_on_transaction / _check_* / _price_anchor → internas, ya inaccesibles.
--
-- REVERSIÓN (Fase E) — reconceder, ya con inventario server-authoritative:
--   grant execute on function public.create_listing(text,int,int) to authenticated;
--   grant execute on function public.buy_listing(uuid)             to authenticated;
--   grant execute on function public.make_offer(text,text,int,uuid,bigint) to authenticated;
--   grant execute on function public.accept_offer(uuid)            to authenticated;
--   -- deposit_card NO se reconcede: lo sustituye la RPC de propiedad de Fase B.
-- ============================================================================

-- ── SEC-01: el vector de acuñación ──────────────────────────────────────────
revoke all on function public.deposit_card(text, int) from public;
revoke all on function public.deposit_card(text, int) from anon;
revoke all on function public.deposit_card(text, int) from authenticated;
grant execute on function public.deposit_card(text, int) to service_role;

-- ── BUG-02: publicar (cierra el bucle publicar→cancelar) ────────────────────
revoke all on function public.create_listing(text, int, int) from public;
revoke all on function public.create_listing(text, int, int) from anon;
revoke all on function public.create_listing(text, int, int) from authenticated;
grant execute on function public.create_listing(text, int, int) to service_role;

-- ── BUG-01: comprar (crédito reembolsado por pushState) ─────────────────────
revoke all on function public.buy_listing(uuid) from public;
revoke all on function public.buy_listing(uuid) from anon;
revoke all on function public.buy_listing(uuid) from authenticated;
grant execute on function public.buy_listing(uuid) to service_role;

-- ── Ofertas que mueven créditos o propiedad ─────────────────────────────────
revoke all on function public.make_offer(text, text, int, uuid, bigint) from public;
revoke all on function public.make_offer(text, text, int, uuid, bigint) from anon;
revoke all on function public.make_offer(text, text, int, uuid, bigint) from authenticated;
grant execute on function public.make_offer(text, text, int, uuid, bigint) to service_role;

revoke all on function public.accept_offer(uuid) from public;
revoke all on function public.accept_offer(uuid) from anon;
revoke all on function public.accept_offer(uuid) from authenticated;
grant execute on function public.accept_offer(uuid) to service_role;

-- ── Rutas de recuperación: se conservan a propósito (ver cabecera) ──────────
grant execute on function public.cancel_listing(uuid) to authenticated;
grant execute on function public.cancel_offer(uuid)   to authenticated;
