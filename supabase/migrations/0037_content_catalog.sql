-- ============================================================================
-- 0037 — EXISTENCIA PERSISTENTE DEL CATÁLOGO DE CARTAS (Bloque 8.1)
--
-- QUÉ RESUELVE
--   La auditoría `docs/cards/CARD-CONTENT-PLANE-AUDIT.md` §1.1 estableció que hoy
--   **una carta no es un dato: es el resultado de una función**. `cardsForPlayer()` deriva
--   772 cartas de 379 jugadores al importar el módulo, y NO existe ninguna fila que las
--   represente. Las tablas que sí las referencian (`user_cards`, `card_mints`,
--   `market_listings`…) apuntan a texto suelto, sin destino.
--
--   Esta migración crea ese destino. Nada más, y a propósito.
--
-- ─────────────── EL PRINCIPIO: LA GENERACIÓN SE CONSERVA ───────────────
--
--   No se sustituye el generador por filas escritas a mano. `PLAYERS × VARIANTES ×
--   cardsForPlayer()` sigue siendo la ÚNICA fuente de CÓMO se construye una carta: es lo
--   que garantiza que el OVR salga de métricas reales y no del criterio de quien teclee.
--
--   Lo que cambia es DÓNDE consta que la carta EXISTE. Antes: en la memoria del proceso
--   que ejecutó el generador. Ahora: en una fila.
--
--       generación  →  TypeScript (intacto)
--       existencia  →  content_cards (nuevo)
--
--   Corolario que el esquema hace cumplir por sí solo: `content_cards` no puede contener
--   una carta cuyo `card_id` no sea exactamente `player_id || '__' || variant_id`. La
--   identidad de las 772 cartas actuales no depende de que el migrador se porte bien; la
--   depende de un CHECK. Ver §2.
--
-- ─────────────── LO QUE ESTA MIGRACIÓN NO HACE ───────────────
--
--   No crea pools, ni pesos por carta, ni sobres como filas, ni versionado de definición,
--   ni snapshots de instancia. Eso es 8.2–8.4 y meterlo aquí sería construir superficie
--   administrativa antes de haber demostrado que la migración no pierde una sola carta.
--
--   **No añade la clave ajena `user_cards.card_id → content_cards.card_id`**, y el motivo
--   no es prudencia genérica sino un dato medido: `card_mints` contiene hoy
--   `derke__champions-mvp`, un `card_id` que el generador NO produce (galardón retirado del
--   roster en algún momento). Es decir: este sistema YA ha acuñado cartas fuera del catálogo
--   semilla. Una FK convertiría ese hecho histórico en un error de escritura y podría
--   bloquear el pipeline de torneos, que concede variantes que el catálogo base no genera.
--   La integridad referencial se vigila en su lugar con la vista de §4 y con
--   `npm run content-catalog:verify`, y la FK queda documentada como deuda de 8.2, cuando
--   el ciclo de vida diga qué hacer con una carta acuñada y luego retirada del generador.
--
-- SEGURIDAD
--   Las tres tablas nacen con RLS activo, CERO políticas y `revoke all` a `anon` y
--   `authenticated`: el cliente no puede ni leer. La lectura la hace el servidor con
--   `service_role`. Es el mismo patrón que `market_audit`/`market_flags` (0004) y las
--   tablas PvP (0031-0036), no uno nuevo.
--
-- REVERSIÓN (conceptual)
--   drop view if exists public.v_content_card_orphans;
--   drop table if exists public.content_cards;
--   drop table if exists public.content_players;
--   drop table if exists public.content_catalog_version;
--   Nada más. Ni una fila de `user_cards`, `card_mints`, `duel_decks` o `market_listings`
--   se toca aquí, así que revertir devuelve el sistema al estado exacto de antes: el
--   catálogo derivado sigue existiendo en código durante toda la transición.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EL ROSTER — los 379 jugadores de `src/data/players.ts` como filas
-- ----------------------------------------------------------------------------
--
-- Es la mitad izquierda del generador. Se persiste ENTERO (no solo los 353 que producen
-- carta) porque un jugador sin carta no es un jugador inexistente: es un jugador cuyo
-- motivo de exclusión (`NO_METRICS`, `INSUFFICIENT_ROUNDS`) hay que poder auditar.
--
-- OJO — esta tabla NO es `public.players`. Esa otra es el mundo esports (84 filas:
-- partidos, predicciones, pick'ems) y no alimenta el catálogo ni lo hará en este bloque.
-- Son dos dominios que comparten nombre; H-6 de la auditoría. No se relacionan aquí.
create table if not exists public.content_players (
  /** El mismo id que en el código: la mitad izquierda de todo `card_id`. */
  id          text primary key,
  nick        text not null,
  full_name   text,
  team        text not null default '',
  team_tag    text not null default '',
  region      text not null check (region in ('EMEA','Americas','Pacific','China')),
  role        text not null check (role in ('Duelista','Iniciador','Centinela','Controlador','Flex')),
  /** ISO-3166 alpha-2, para la bandera. */
  country     text not null default '',
  /** Las 6 estadísticas heredadas (dmg/scr/com/hs/ast/clu). No participan en el combate. */
  stats       jsonb not null,
  /** Métricas VLR de origen. Es lo que permite REGENERAR el trío de combate. */
  metrics     jsonb,
  /** Trío editorial autorizado a mano (con motivo y autor). Vía de excepción, ver `Player`. */
  editorial   jsonb,
  accolades   text[] not null default '{}',
  image       text,
  status      text not null default 'active' check (status in ('active','inactive')),
  /**
   * De dónde salió la fila. `seed` = migrada desde `src/data/players.ts`.
   * Existe para que, cuando 8.2+ permita altas por panel, se pueda distinguir qué es
   * semilla reproducible y qué es autoría administrativa.
   */
  origin      text not null default 'seed' check (origin in ('seed','admin','import')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
/*
 * NO hay `ordinal` aquí, y la asimetría con `content_cards` es deliberada. Allí el orden
 * cambia el resultado del sorteo (se elige por índice dentro del pool) y por eso se
 * persiste. Aquí los jugadores solo se consultan por id, contra un `Map`: el orden no
 * afecta a nada. Añadir la columna «por simetría» habría sido inventar una restricción que
 * complica el alta de un jugador desde el panel a cambio de ninguna propiedad.
 */
create index if not exists content_players_region_idx on public.content_players(region);
create index if not exists content_players_team_idx   on public.content_players(team);

-- ----------------------------------------------------------------------------
-- 2. LA FILA QUE HOY NO EXISTE — una por definición de carta
-- ----------------------------------------------------------------------------
--
-- Contiene TODO lo necesario para reconstruir el `CardDef` que hoy devuelve el generador,
-- campo por campo, sin volver a ejecutarlo. Esa es la condición para que el servidor pueda
-- usarla como autoridad de existencia: si faltara un campo, habría que rederivarlo, y
-- entonces la BD no sería autoridad de nada.
--
--   CardDef            →  columna
--   ─────────────────     ────────────────────────
--   id                 →  card_id (PK)
--   playerId           →  player_id (FK)
--   variantId          →  variant_id
--   ovr                →  ovr
--   stats              →  stats        (jsonb, las 6 heredadas)
--   combat             →  combat       (jsonb, el trío SH/GS/EF)
--   statBoost          →  stat_boost
--   dataVersion        →  data_version
--   source             →  source
--   generatedAt        →  generated_at
--
-- `rarity_rank` y `rarity_bucket` NO están en `CardDef`: se derivan hoy en dos saltos
-- (`variantId → variant.rank → bucketForRank`). Se materializan porque sin ellos no se
-- puede indexar ni consultar el catálogo por rareza sin recorrerlo entero — que es
-- exactamente lo que la auditoría señala como imposible de administrar (H-4). Los escribe
-- SIEMPRE el generador; no son campos que nadie teclee.
create table if not exists public.content_cards (
  /**
   * IDENTIDAD. Es el mismo texto que ya guardan `user_cards.card_id`, `card_mints.card_id`,
   * `market_listings.card_id` y las recompensas de eventos. Preservarlo exactamente es la
   * condición número uno de esta migración: cambiar un id aquí rompería la propiedad de un
   * jugador real.
   */
  card_id       text primary key,
  player_id     text not null references public.content_players(id) on delete restrict,
  variant_id    text not null,

  /*
   * EL ORDEN DE GENERACIÓN. No es cosmético: es parte del comportamiento actual del sorteo.
   *
   * `buildPool()` recorre el catálogo EN ORDEN y `rng.pick(candidates)` elige por ÍNDICE.
   * El catálogo del código sale de recorrer `PLAYERS` y, dentro de cada jugador, el conjunto
   * de variantes que `cardsForPlayer()` compone — un orden que NO es alfabético. Si estas
   * filas se leyeran ordenadas por `card_id`, el pool tendría el mismo CONJUNTO de cartas
   * pero en otras posiciones, y la misma semilla entregaría OTRA carta.
   *
   * No es una hipótesis: la comprobación de determinismo de `content-catalog:verify` falló
   * exactamente así antes de existir esta columna (3 de los 13 sobres divergían con las
   * mismas semillas). Persistir el ordinal es lo que hace que «la salida funcional es
   * equivalente» sea cierto carta a carta, y no solo en distribución.
   */
  ordinal       int not null check (ordinal >= 0),

  -- ── El resultado del generador ──
  ovr           int    not null check (ovr between 1 and 99),
  stats         jsonb  not null,
  combat        jsonb  not null,
  /** Escalera cerrada de `STAT_BOOST_STEPS`. Ningún otro valor es válido en el dominio. */
  stat_boost    int    not null check (stat_boost in (0,2,4,6,9,12)),

  -- ── Rareza materializada (derivada de la variante, no editable a mano) ──
  rarity_rank   int  not null check (rarity_rank >= 1),
  rarity_bucket text not null check (rarity_bucket in ('common','uncommon','rare','epic','legendary')),

  -- ── Procedencia y determinismo ──
  /** `DATA_VERSION` del modelo de combate con el que se derivó ("VCT-2026"). */
  data_version  text not null,
  /** `vlr` (métricas reales) o `editorial` (trío autorizado a mano). Las dos únicas vías. */
  source        text not null check (source in ('vlr','editorial')),
  /** `CATALOG_GENERATED_AT`: constante del build, no un reloj. Dos ejecuciones ⇒ el mismo valor. */
  generated_at  timestamptz not null,
  /** Quién materializó la fila. `seed-generator` = `cardsForPlayer()` sobre el roster semilla. */
  origin        text not null default 'seed-generator'
                check (origin in ('seed-generator','admin','tournament')),

  -- ── Estado administrativo (mínimo viable de 8.1; el ciclo completo es 8.2) ──
  /**
   * Las 772 migradas nacen PUBLISHED porque **ya están en el juego**: hay usuarios que las
   * poseen. Marcarlas DRAFT las sacaría del catálogo y rompería 53 instancias reales.
   * El resto de estados existe para que 8.2 no tenga que migrar la columna, pero en este
   * bloque NADA los usa: no hay transición, ni UI, ni RPC que los mueva.
   */
  lifecycle     text not null default 'PUBLISHED'
                check (lifecycle in ('DRAFT','REVIEW','APPROVED','PUBLISHED','RETIRED','ARCHIVED','REJECTED')),
  /** Sube solo cuando cambie algo que afecte al juego. Arranca en 1. La regla la impone 8.2. */
  definition_version int not null default 1 check (definition_version >= 1),
  published_at  timestamptz,
  retired_at    timestamptz,

  /**
   * Huella de los campos que afectan al juego (sha256 de un JSON canónico).
   *
   * No es decoración: es lo que permite comparar 772 cartas persistidas contra 772
   * generadas en O(n) y detectar una divergencia sin traerse el catálogo entero. Lo calcula
   * el migrador con la MISMA función que usa el verificador, así que si alguna vez difieren
   * es porque el contenido difiere de verdad.
   */
  checksum      text not null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  /**
   * LA IDENTIDAD ES UN INVARIANTE DEL ESQUEMA, NO UNA CONVENCIÓN.
   *
   * `card_id = playerId__variantId` se cumple hoy en el 100 % del catálogo porque
   * `buildCard()` lo compone así. Aquí deja de depender de que nadie se equivoque al
   * escribir: una fila que no lo cumpla no entra. Es la garantía barata de que ninguna
   * migración, ni ahora ni en 8.4, pueda regenerar un id y desanclar las cartas que la
   * gente ya tiene.
   */
  constraint content_cards_identity check (card_id = player_id || '__' || variant_id)
);
-- Único: dos cartas no pueden ocupar la misma posición del catálogo. Es lo que impide que
-- una materialización a medias deje el orden ambiguo — y ambiguo aquí significa que el
-- sorteo dejaría de ser reproducible.
create unique index if not exists content_cards_ordinal_uniq on public.content_cards(ordinal);
create index if not exists content_cards_player_idx    on public.content_cards(player_id);
create index if not exists content_cards_variant_idx   on public.content_cards(variant_id);
create index if not exists content_cards_bucket_idx    on public.content_cards(rarity_bucket);
create index if not exists content_cards_lifecycle_idx on public.content_cards(lifecycle);
-- El sorteo de sobres pregunta siempre lo mismo: cartas publicadas de un bucket.
create index if not exists content_cards_live_idx
  on public.content_cards(rarity_bucket, variant_id) where lifecycle = 'PUBLISHED';

-- ----------------------------------------------------------------------------
-- 3. LA VERSIÓN DEL CATÁLOGO — una fila, y sirve para no leerlo entero
-- ----------------------------------------------------------------------------
--
-- El servidor mantiene el catálogo en memoria (772 filas, ~1 MB): traerlo en cada petición
-- sería absurdo. Pero un catálogo en memoria que no sabe que ha caducado es exactamente el
-- bug que la auditoría describe en §1.8 («con 2 instancias, 2 catálogos distintos»).
--
-- Esta tabla es la señal barata: UNA fila, un entero. Cada proceso compara su versión con
-- la de aquí (una query trivial, cacheada unos segundos) y solo recarga si cambió.
--
-- `catalog_checksum` es la huella del catálogo COMPLETO (sha256 sobre los checksums de las
-- cartas, ordenados). Permite responder «¿mi copia es exactamente esta?» sin comparar 772
-- filas, y es lo que hace barato el trinquete anti-divergencia del verificador.
create table if not exists public.content_catalog_version (
  /** Cerrojo de fila única: `id` solo puede valer `true`. */
  id               boolean primary key default true check (id),
  version          bigint  not null default 1 check (version >= 1),
  cards_count      int     not null default 0 check (cards_count >= 0),
  players_count    int     not null default 0 check (players_count >= 0),
  catalog_checksum text    not null default '',
  updated_at       timestamptz not null default now()
);
insert into public.content_catalog_version (id) values (true) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. INTEGRIDAD REFERENCIAL SIN CLAVE AJENA — vigilar en vez de bloquear
-- ----------------------------------------------------------------------------
--
-- Es la alternativa honesta a la FK que §0 explica por qué no se pone. No impide nada:
-- ENSEÑA. Devuelve cero filas cuando todo está anclado, y cuando no, dice exactamente qué
-- tabla apunta a qué carta inexistente. `content-catalog:verify` la consulta y el informe
-- la publica.
--
-- Es de solo lectura y no se concede a nadie salvo `service_role` (§5), porque enumera
-- referencias de todos los usuarios.
create or replace view public.v_content_card_orphans as
  select 'user_cards'      as source_table, uc.card_id, count(*)::bigint as refs
    from public.user_cards uc
    left join public.content_cards cc on cc.card_id = uc.card_id
   where cc.card_id is null
   group by uc.card_id
  union all
  select 'card_mints', cm.card_id, cm.minted::bigint
    from public.card_mints cm
    left join public.content_cards cc on cc.card_id = cm.card_id
   where cc.card_id is null
  union all
  select 'market_listings', ml.card_id, count(*)::bigint
    from public.market_listings ml
    left join public.content_cards cc on cc.card_id = ml.card_id
   where cc.card_id is null
   group by ml.card_id
  union all
  select 'card_reference', cr.card_id, 1::bigint
    from public.card_reference cr
    left join public.content_cards cc on cc.card_id = cr.card_id
   where cc.card_id is null;

-- ----------------------------------------------------------------------------
-- 5. SEGURIDAD — el cliente no toca esto ni para leer
-- ----------------------------------------------------------------------------
--
-- RLS activo y NINGUNA política. En PostgreSQL eso significa «denegado por defecto» para
-- todo rol que no sea el propietario o `service_role` (que lo evita por BYPASSRLS). El
-- `revoke` es cinturón además de tirantes: aunque un día alguien añadiera una política por
-- error, sin GRANT no hay acceso.
--
-- Por qué CERO lectura pública y no «lectura de lo publicado»: en 8.1 el cliente todavía
-- renderiza desde el catálogo generado en TypeScript, que el verificador demuestra idéntico
-- al persistido. Abrir una superficie de lectura que nadie consume sería ampliar el área de
-- ataque a cambio de nada. La proyección pública de solo-publicado es de 8.2, cuando el
-- panel exista y haya algo que leer que el código no tenga.
alter table public.content_players         enable row level security;
alter table public.content_cards           enable row level security;
alter table public.content_catalog_version enable row level security;

revoke all on public.content_players         from anon, authenticated;
revoke all on public.content_cards           from anon, authenticated;
revoke all on public.content_catalog_version from anon, authenticated;
revoke all on public.v_content_card_orphans  from anon, authenticated;

-- La vista se ejecuta con los permisos de quien la consulta, no del propietario. Sin esto
-- una vista sobre tablas con RLS puede convertirse en un rodeo para leerlas.
alter view public.v_content_card_orphans set (security_invoker = true);

comment on table public.content_cards is
  'Bloque 8.1 — EXISTENCIA persistida del catálogo. La GENERACIÓN sigue en src/data/catalog.ts; '
  'estas filas las materializa `npm run content-catalog:migrate` ejecutando cardsForPlayer(). '
  'No se editan a mano: content-catalog:verify falla si divergen del generador.';
comment on table public.content_players is
  'Bloque 8.1 — el roster de src/data/players.ts como filas. NO es public.players (esports).';
comment on table public.content_catalog_version is
  'Bloque 8.1 — una fila. Señal de caducidad para los catálogos en memoria de cada proceso.';
