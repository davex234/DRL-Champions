# Backend de DRL Champions (Supabase)

La plataforma online es **opcional y aditiva**: sin configurar, el juego funciona
en modo local (localStorage). Al configurar Supabase se activan cuentas,
sincronización en la nube, rankings y mercado entre jugadores — sin cambiar
ninguna mecánica de juego.

## Puesta en marcha

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. SQL Editor → pega y ejecuta `supabase/migrations/0001_init.sql`.
   Crea tablas (`profiles`, `game_state`, `inventory`, `market_listings`,
   `transactions`), políticas **RLS**, triggers y las funciones **RPC**
   (`buy_listing`, `create_listing`, `cancel_listing`, `deposit_card`) que
   validan en el servidor las operaciones críticas. También crea las vistas de
   ranking (`ranking_level`, `ranking_collection`, `ranking_market`,
   `ranking_rarities`).
3. Authentication → Providers → Email: habilítalo (y desactiva "Confirm email"
   si quieres registro instantáneo en desarrollo).
4. Settings → API: copia `Project URL` y `anon public key` a `.env.local`:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
   ```

5. `npm run dev` → ve a **/cuenta** para registrarte.

## Seguridad (no confiar en el cliente)

- **RLS** en todas las tablas: cada usuario solo lee/escribe sus filas; los
  perfiles son de lectura pública (para rankings).
- El **inventario de servidor** y los **listados** solo se modifican mediante
  funciones `SECURITY DEFINER`, nunca con `INSERT/UPDATE` directos del cliente.
- `buy_listing` hace la transferencia de créditos y propiedad de forma
  **atómica** dentro de la base de datos, con bloqueo de fila (`FOR UPDATE`) y
  todas las validaciones (saldo, propiedad, estado del listado).

## Migración progresiva

Al iniciar sesión por primera vez, el estado local (sobres, colección, eventos,
logros, economía) se sube a `game_state`. En siguientes sesiones se descarga y
se fusiona. El motor del juego sigue siendo el de siempre: la nube añade
persistencia multi-dispositivo y los campos denormalizados para el ranking.

## Siguiente paso (economía 100% server-authoritative)

Para miles de usuarios con total anti-trampas, el siguiente paso es mover la
apertura de sobres al servidor (RPC `open_pack` con RNG y cobro de créditos en
BD) e independizar `profiles.credits` del cliente. La estructura ya está lista
para ello (inventario normalizado + RPC).
