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

## Sistema competitivo (estilo VLR.gg) — `0003_competitive.sql`

Construye el catálogo deportivo completo sobre las tablas del DRL Data Engine
(`0002`). Ejecútalo después de `0001` y `0002`.

**Jerarquía:** `circuits` → `events` (torneos) → `stages` (fases) → `matches` →
`match_maps` → `map_player_stats`. Más `standings` (clasificaciones por fase),
`team_stats` y `player_event_stats` (agregados), `agents`/`maps` (referencia),
`roster_changes` (transferencias) y `sync_state` (control de sincronización).

Escala a VCT Internacional, Challengers, Game Changers, Ascension y Tier 2/3
mediante el campo `tier` de `circuits`/`events`. La migración es **idempotente**
(re-ejecutable) y trae seeds de agentes, mapas y circuitos base.

- **RLS:** lectura pública de todo el catálogo; la escritura la hace solo el
  backend con `service_role`.
- **RPC de recálculo** (solo `service_role`): `recompute_standings(event)`,
  `recompute_team_stats(team, event)`, `recompute_player_event_stats(event)`.
- **Vistas:** `v_upcoming_matches`, `v_recent_results`, `v_player_leaderboard`.

### Sincronización

1. Settings → API: copia la **`service_role` key** a `.env.local` (SOLO
   servidor, nunca con prefijo `NEXT_PUBLIC_`) y define un secreto de disparo:

   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
   SYNC_SECRET=un-secreto-largo
   # Opcional: proxy que devuelve las formas Raw* de @/lib/esports/sync/source
   NEXT_PUBLIC_VLR_API=https://tu-proxy.example/api
   ```

2. Dispara la sincronización (cron / edge) con un `POST` autenticado:

   ```bash
   curl -X POST https://tu-app/api/esports/sync \
     -H "x-sync-secret: $SYNC_SECRET" \
     -H "content-type: application/json" \
     -d '{"source":"mock"}'   # "vlr" para el proxy real; opcional "tournamentId"
   ```

   El orquestador (`@/lib/esports/sync/orchestrator`) normaliza, hace upsert y
   ejecuta las RPC de recálculo. La fuente `mock` siembra un torneo de ejemplo
   con un partido finalizado para validar el flujo de punta a punta.

3. **Lectura** desde la app vía la clave anon: `@/lib/esports/repos`
   (`matches.listUpcoming()`, `standings.getStandings()`, `stats.getPlayerLeaderboard()`…).

## Mercado global con economía real — `0004_market.sql`

Amplía el mercado de `0001` a una economía entre usuarios para miles de
jugadores. Ejecútalo después de `0001` (y de `0003` si usas el módulo
competitivo). Es **idempotente**.

**Qué añade:**
- **Impuesto de mercado** (5% configurable en `market_config.tax_bps`): el
  vendedor recibe `precio − impuesto`; el impuesto se **quema** (sink
  antiinflación) y se contabiliza en `market_config.total_burned`. Aplica en
  `buy_listing` y `accept_offer`.
- **Ofertas** (`market_offers`): órdenes de compra por carta (`kind='card'`) y
  contraofertas a un listado (`kind='listing'`). Los créditos se **retienen**
  al ofertar y se liberan al aceptar/cancelar/expirar. RPCs `make_offer`,
  `cancel_offer`, `accept_offer`, `expire_offers` (cron, solo `service_role`).
- **Historial y precio medio** (`card_price_stats`) y **serie temporal para
  gráficas** (`card_price_daily`), mantenidos por un trigger en `transactions`.
- **Antifraude server-side**: rate limits por hora, banda de precio respecto a
  un ancla (media de mercado o valor justo), detección de wash-trading entre el
  mismo par, cooldown de reventa, `self_trade`; con `market_audit` (auditoría) y
  `market_flags` (alertas). *Nota:* los rechazos (block) revierten la
  transacción, así que el flag de bloqueo no persiste (sí persisten los
  detectives como `wash_trade`); para un log de intentos bloqueados haría falta
  una cola/edge function.
- **Búsqueda** paginada y ordenable (`search_listings`, incl. orden "chollos"),
  y **analítica**: `v_market_top_cards` (ranking de cartas más valiosas) y
  `v_market_rarity_stats` (por rareza).
- **`card_reference`**: espejo del catálogo (valor justo, rareza, nick/equipo/
  región/OVR) que alimenta búsqueda, banda de precio y analítica.

**Puesta en marcha del mercado:**
1. Aplica `0004_market.sql`.
2. Puebla la referencia (usa `SUPABASE_SERVICE_ROLE_KEY` + `SYNC_SECRET`):
   ```bash
   curl -X POST https://tu-app/api/market/sync-reference -H "x-sync-secret: $SYNC_SECRET"
   ```
   Reejecútalo tras cambios de roster/catálogo.
3. Cliente: `@/lib/supabase/market.ts` (`searchListings`, `makeOffer`,
   `acceptOffer`, `fetchCardPriceDaily`, `fetchTopCards`, `fetchRarityStats`…).
   UI en `/mercado` → pestaña **Global** (Comprar / Mis ofertas / Analítica).
4. Programa `select expire_offers();` periódicamente (cron) para liberar
   depósitos de ofertas vencidas.

## IA de análisis competitivo (predicciones) — `0005_predictions.sql`

Construye la IA propia de análisis sobre el módulo competitivo (0003). Ejecútalo
después de `0003`. Es **idempotente**.

**Qué añade:**
- `team_ratings` — Elo por equipo, recomputado desde los partidos finalizados.
- `predictions` — por partido y versión de modelo: **probabilidad de victoria**,
  **marcador previsto**, **MVP probable**, **jugador revelación**, confianza,
  riesgo de sorpresa, narrativa de IA y factores clave.
- `prediction_players` — proyección por jugador (MVP / revelación).
- **Vistas de precisión**: `v_prediction_accuracy` (por predicción: acierto de
  ganador, **Brier score**, marcador exacto) y `v_model_accuracy` (agregado por
  modelo). RLS de lectura pública; escritura solo `service_role`.

**Motor (escalable y preciso):** un modelo estadístico determinista
(`src/domain/esports/predict/`: Elo + regresión logística + forma reciente + H2H
+ ventaja por mapas) es la **fuente de verdad** de las probabilidades — predice
miles de partidos sin coste de LLM. La capa de IA (`src/lib/esports/ai/`) añade el
análisis cualitativo: **Claude** si hay `ANTHROPIC_API_KEY` (salida JSON
estructurada, caché de prompt, Batch API; `claude-opus-4-8` por defecto,
`claude-haiku-4-5` en lotes), o un **proveedor heurístico** local sin coste.

**Uso:**
1. Aplica `0005_predictions.sql`.
2. (Opcional) Configura la IA en `.env.local`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...     # sin esto, usa el heurístico local
   ANTHROPIC_MODEL=claude-opus-4-8
   ANTHROPIC_MODEL_BULK=claude-haiku-4-5
   ```
3. Recomputa Elo y predice (cron/edge), protegido por `SYNC_SECRET`:
   ```bash
   curl -X POST https://tu-app/api/esports/predict -H "x-sync-secret: $SYNC_SECRET" \
     -H "content-type: application/json" -d '{"mode":"ratings"}'
   curl -X POST https://tu-app/api/esports/predict -H "x-sync-secret: $SYNC_SECRET" \
     -H "content-type: application/json" -d '{"mode":"upcoming","provider":"heuristic"}'
   ```
   También `{"mode":"match","matchId":"...","provider":"claude"}`.
4. **Lectura** vía `@/lib/esports/repos/predictions` (`getPrediction`,
   `listUpcomingPredictions`, `getTeamRatings`, `getMatchPlayerProjections`,
   `getModelAccuracy`).

## Generación automática de cartas por torneos — `0006_tournaments.sql`

Sistema **dirigido por el admin**: crea torneos, gestiona equipos/jugadores y, al
finalizar (o eliminar un equipo), genera cartas según un **motor de rareza
configurable en BD**. Ejecútalo después de `0001`/`0003`. Idempotente.

**Tablas:** `tournaments` (autoría admin, enlace opcional a un `events.id`),
`tournament_teams`, `tournament_players` (con `rating` que alimenta la rareza),
`card_generation_rules` (motor de rareza editable — seed con ≥1.30 Legendaria,
≥1.20 Épica, ≥1.10 Rara, <1.10 Común + reglas MVP→`tournament-mvp` y
Champion→`tournament-champion`), `player_cards`, `special_cards` (un solo MVP por
torneo vía índice único parcial), `card_generations` (historial) y `card_photos`
(arquitectura de fuentes Riot/evento/redes/frames — solo diseño, sin scraping).
Añade `profiles.is_admin`. RLS de lectura pública; **escritura solo vía la ruta
admin con service_role**.

**Cartas jugables:** las generadas se integran al catálogo jugador×variante. Se
añadieron dos variantes nuevas — **MYTHIC** (`mythic`, MVP) y **CHAMPION**
(`champion-edition`) — y las accolades `tournament-mvp`/`tournament-champion`. Al
generar, el admin aplica las accolades al roster local y las cartas pasan a ser
poseíbles / abribles en sobres / visibles en la colección.

**Motor:** `CardGenerationEngine` (`src/lib/tournaments/engine.ts`) + reglas puras
`src/domain/tournaments/rarity.ts` (rating→tier→variante; MVP/Champion especiales;
selección de foto por prioridad de fuente).

**Uso:**
1. Aplica `0006_tournaments.sql`.
2. Marca un administrador: `update public.profiles set is_admin = true where id = '<uuid>';`
3. Entra en **Admin > Torneos** (`/admin/torneos`, requiere `NEXT_PUBLIC_ADMIN=1`
   y sesión de ese usuario): crea el torneo, añade jugadores (del catálogo del
   juego) con su `rating`, marca el equipo ganador y pulsa **Finalizar** o
   **Equipo eliminado**. La ruta `POST /api/admin/tournaments` valida `is_admin`
   (Bearer token) y escribe con service_role.

**Futuras integraciones:** `import_from_event` (en la ruta) ya enlaza torneos con
datos competitivos sincronizados (VLR); `card_photos.source` modela la prioridad
de fuentes para cuando se añadan conectores.

## Asset Manager (`0007_assets.sql`)

Sistema **unificado y escalable** (cientos de miles de medios) para los 10 tipos
de assets del juego: fotos de jugadores, logos de equipos/ligas/torneos, banderas,
roles, plantillas de cartas, fondos, animaciones y efectos.

**Tabla canónica `assets`** — cada asset guarda: `id`, `name`, `kind`,
`subject_type`+`subject_id` (sujeto del catálogo del juego, `text` sin FK),
`source`, `quality`, `width`/`height` (resolución), `format`, `bytes`, `checksum`
(sha-256, deduplicado), `priority`, `status` (pending/approved/rejected/archived),
`license`, `version`+`group_id`+`is_current` (versionado), `bucket`+`storage_path`
+`url` (Supabase Storage), `captured_at`, `tags`, `meta`.

**Binarios** en el bucket público `assets` de Supabase Storage, particionados por
`kind/subject_id/asset_id.ext`. El checksum y la resolución se calculan **en el
navegador** antes de subir (barato a escala). La subida real va por la ruta admin
con service_role.

**Resolución automática** ("dame la mejor imagen para este jugador"): la tabla
**`asset_best`** (PK `kind,subject_type,subject_id`) guarda el mejor asset aprobado
y vigente, **mantenida por el trigger `assets_best_sync`** (orden: prioridad →
calidad → resolución → versión). Lectura O(1) vía RPC `best_asset(...)` o
directamente sobre `asset_best`. En TS: `resolveAssetUrl()`/`resolvePlayerImage()`
en `src/lib/assets.ts` (con fallback a las rutas estáticas si no hay asset).

**Búsqueda** `search_assets(...)` (paginada, por jugador/equipo/torneo/tipo/estado/
texto, respeta RLS) y **duplicados** `v_asset_duplicates` (checksums repetidos).

**Compatibilidad:** `card_photos` (0006) se vuelca a `assets` (backfill idempotente)
y pasa a ser una **vista** sobre `assets` (kind `player_photo`) — el motor de
torneos sigue leyendo de `card_photos` sin cambios. La tabla original queda como
`card_photos_legacy`.

**Panel:** **Admin > Assets** (`/admin/assets`, requiere `NEXT_PUBLIC_ADMIN=1` +
sesión admin): subir, reemplazar (versiones), aprobar/rechazar, fijar prioridad/
licencia, eliminar y deduplicar; búsqueda por jugador/equipo/torneo. Ruta
`POST /api/admin/assets` (valida `is_admin`, escribe con service_role, sube a
Storage). RLS: lectura pública de lo **aprobado**; escritura solo service_role.

**Uso:**
1. Aplica `0007_assets.sql` (crea el bucket `assets` si Storage está disponible).
2. Entra en **Admin > Assets**, sube medios y apruébalos.
3. El render del juego pedirá automáticamente el mejor asset aprobado por sujeto.

## Collection Engine (`0008_collections.sql`)

Cada torneo genera automáticamente una **colección completa**: todos los jugadores
+ premios (Champion Edition, MVP, Rookie, Clutch, Top ACS, Top Rating, Top HS%,
Top Kills, Top Assist). Con **progreso / % / obtenidas / faltantes** y una
**recompensa exclusiva** al completarse. Páginas **pública** (escaparate
compartible) y **privada** (mi progreso), filtros y **logros automáticos**.

**Premios = cartas nuevas**: 7 accolades/variantes (`top-acs`, `top-rating`,
`top-hs`, `top-kills`, `top-assist`, `rookie`, `clutch`) junto a `mythic`(MVP) y
`champion-edition`. Cálculo PURO en `src/domain/collections/awards.ts`
(`computeAwards`: líder por métrica, desempate por rating, rookie por flag).

**Generación**: al finalizar un torneo, `generateForFinish` añade las specs de
premio y `persistCollection` (`src/lib/tournaments/engine.ts`) upserta
`collections` + `collection_items` con todos los miembros. Las cartas premio se
vuelven jugables al aplicar las accolades al roster (`upsertWithAccolades`).

**Esquema 0008** (idempotente): ALTER `tournament_players` (`kills`, `assists`,
`hs_pct`, `clutch`, `is_rookie`); relaja el `check` de `special_cards.kind` para
admitir los 7 premios + índice único parcial (un premio por torneo/kind); tablas
`collections` (1 torneo → 1 colección, `slug` único, `reward jsonb`) y
`collection_items` (`unique(collection_id, card_id)`). RLS lectura pública;
escritura solo service_role.

**Dual local + Supabase**: dominio source-agnostic (`CollectionDef`). Proveedor
LOCAL (`src/domain/collections/local.ts`) genera una colección por evento desde el
catálogo (offline); Supabase aporta las de torneos reales. `mergedCollections()`
(`src/lib/collections/repos.ts`) las combina deduplicando por slug.

**Páginas**: `/colecciones` (privada, "Mis Colecciones": progreso + reclamar) y
`/colecciones/{slug}` (pública, escaparate). Recompensas vía `useCollectionsStore`
(anti-doble-claim) + helper compartido `src/lib/rewards.ts`. Logros automáticos
fusionados en `/logros`.

## Siguiente paso (economía 100% server-authoritative)

Para miles de usuarios con total anti-trampas, el siguiente paso es mover la
apertura de sobres al servidor (RPC `open_pack` con RNG y cobro de créditos en
BD) e independizar `profiles.credits` del cliente. La estructura ya está lista
para ello (inventario normalizado + RPC).
