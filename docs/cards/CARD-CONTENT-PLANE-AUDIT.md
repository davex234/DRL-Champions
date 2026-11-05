# NEXUS Card Admin / Content Control Plane — AUDITORÍA Y PROPUESTA

> **Bloque 8 · Fase 1–11. NO se ha implementado nada.** Este documento es el informe previo que
> el encargo pide antes de escribir código. Termina con una decisión que necesita tu visto bueno.

---

## 0. Conclusión primero

**La arquitectura actual no soporta este sistema, y el motivo no es que falte un CRUD.**

Hoy una carta **no es un dato: es el resultado de una función**. El catálogo se calcula en
TypeScript al importar el módulo, a partir de `PLAYERS × variantes`. No existe tabla de cartas.
No existe fila que crear.

Y ya existe un panel de administración de cartas… que **no administra nada real**: sus cambios se
guardan en el `localStorage` del navegador del admin y mutan un singleton en memoria del proceso.
El servidor —el que abre los sobres de verdad— nunca se entera.

Siguiendo tu instrucción («si descubres que la arquitectura no lo soporta, detente y propón la
correcta»), **me detengo aquí** y propongo abajo la arquitectura. No hay parche rápido posible:
cualquier atajo sería exactamente la «demo administrativa» que has pedido no construir.

---

# FASE 1 — AUDITORÍA

## 1.1 Cómo existe una carta hoy

```
src/data/players.ts   (379 jugadores, código)
        │
        ├── playerCombatBase(player)          métricas VLR reales → CombatStats
        │                                     o vía editorial explícita y auditada
        │                                     o NADA (26 jugadores no generan carta)
        ▼
cardsForPlayer(player)                        decide QUÉ variantes existen para ese jugador:
        │                                       · metal base según OVR sin bonus
        │                                       · su región
        │                                       · una por cada accolade (palmarés)
        ▼
buildCard(player, variant)                    deriveCard(base, variant.statBoost) → combat + ovr
        ▼
CARDS: CardDef[]                              772 cartas · id = `${playerId}__${variantId}`
```

Medido en vivo:

| | |
|---|---|
| Jugadores semilla (TS) | **379** |
| Cartas derivadas | **772** |
| Variantes definidas | **37** (25 con cartas, **12 vacías**) |
| Jugadores sin carta | **26** (`NO_METRICS`) |
| `id === playerId__variantId` | **100 %** |

Las 12 variantes vacías (`hall-of-fame`, `mythic`, `game-changers`, `champion-edition`, `rookie`,
`clutch`, `top-*`, `americas-mvp`) existen en el código con paleta, rank y tirada limitada, pero
**ninguna carta las usa**: nadie tiene el accolade que las abre. Son capacidad instalada esperando
un administrador — justo lo que este bloque quiere entregar.

## 1.2 Qué hay en base de datos

Hay **dos conceptos distintos de «jugador»** que no se hablan entre sí:

| | `src/data/players.ts` | tabla `public.players` |
|---|---|---|
| Filas | 379 (código) | **84** (BD local) |
| Para qué | **generar cartas** | esports: partidos, predicciones, torneos, pick'ems |
| Quién lo lee | catálogo, packs, colección, duelos | `src/lib/esports/*`, `/api/admin/tournaments` |
| ¿Alimenta el catálogo? | **sí, en exclusiva** | **no, nunca** |

Verificado: **ningún** archivo bajo `src/app/api/` o `src/server/` lee la tabla `players` para
construir el catálogo. Son dos mundos separados que comparten nombre.

Y las tablas que sí referencian cartas lo hacen **por texto suelto, sin clave ajena** (no puede
haberla: no hay tabla a la que apuntar):

| Tabla | Columna | FK | Qué guarda |
|---|---|---|---|
| `user_cards` | `card_id text` | **no** | la instancia poseída |
| `card_mints` | `card_id text` (PK) | **no** | seriales acuñados globalmente |
| `card_reference` | `card_id text` (PK) | **no** | **espejo del catálogo TS** (0 filas hoy) |
| `card_price_stats` / `card_price_daily` | `card_id` | no | precios |
| `market_listings` / `market_offers` | `card_id` | no | mercado |
| `user_packs` | `pack_id text` | no | sobres sin abrir |
| `duel_decks` | `card_uids uuid[]` | → `user_cards.uid` | mazos |

**`card_reference` es el precedente que importa.** Su cabecera lo dice: *«denormalizada del
catálogo TS; la puebla un route»*. Ya existe el patrón «TS genera → BD proyecta», vía
`POST /api/market/sync-reference`. La arquitectura que propongo generaliza ese patrón en lugar de
inventar otro.

## 1.3 La instancia

```sql
user_cards( uid uuid PK, user_id, card_id text, serial int, origin text,
            locked bool, obtained_at timestamptz )
```

**Una instancia es un puntero y nada más.** No guarda OVR, ni stats, ni rareza, ni valor. Todo eso
se resuelve en vivo contra el catálogo cada vez que se lee.

Consecuencia directa, y es el mayor riesgo de integridad del sistema actual:

> Si mañana cambian las métricas de un jugador, **las 500 cartas que ya poseen los usuarios cambian
> de estadísticas, de OVR, de valor de mercado y de desguace, en silencio y con efecto retroactivo.**

Lo único que sí protege el modelo: `user_cards_serial_uniq (card_id, serial)` — un serial es único
en todo el sistema.

## 1.4 Qué sí queda congelado (buena noticia)

El duelo **sí** congela. `takeDeckSnapshot` guarda en `duel_matches.state` un `DuelDeckCard` por
carta con `combat`, `ovr`, `statBoost`, `dataVersion` y `serial` **ya resueltos**. Una partida en
curso o histórica es inmune a un cambio de catálogo.

O sea: **las partidas están a salvo; las colecciones no.**

## 1.5 Sobres y probabilidad

El modelo actual, leído en `openPack.ts` + `pool.ts`, ya es de dos capas:

```
PackDef.weights          pesos por BUCKET de rareza (common…legendary)
      │                  renormalizados sobre los buckets CON STOCK
      ▼
buildPool(registry,pack) filtra el catálogo con las restricciones del sobre:
      │                  pool explícito · allowedVariants · excludeVariants
      │                  restrictGroups · serializedOnly · series · región
      ▼
rng.pick(candidates)     ← UNIFORME dentro del bucket
```

Por tanto hoy:

```
P(carta) = P(bucket) × 1 / |cartas del bucket en el pool|
```

**No existe peso por carta.** Es la pieza que falta para lo que pides en la Fase 7.

Lo que sí existe y es sólido: `guaranteedMin`, `guarantees[]` (por hueco, con grupo/serializada),
`pity` configurable, `antiDuplicate` con 5 políticas, `repeatable`, y un pool cacheado
(`WeakMap` por registry → `Map` por `pack.id`) que hace la apertura O(1). **El motor no hay que
rehacerlo.** `PackDef` ya tiene incluso un campo `pool?: string[]`.

Los 13 sobres viven en `src/data/packs.ts`, en código.

## 1.6 Economía

Funciones **puras del catálogo**:

- `marketValue(card)` = `50 × rankMultiplier(variant.rank) × ovrMultiplier(card.ovr)`
- `instanceValue(card, serial)` = `marketValue × serialMultiplier(serial, serialLimit)`
- `salvageValue(card)` = tabla fija por bucket de rareza

Dependen de `variant.rank` y `card.ovr`. **Cambiar el OVR de una carta publicada mueve el precio de
todas sus instancias y la banda antifraude del mercado** (`card_reference.fair_value` → `_price_anchor`
→ `_check_price_band`).

## 1.7 Duelos

`combat.ts` **no conoce** `cardId`, ni rareza, ni variante. Consume `CombatStats` (el trío
Stronghold/Gamesense/Entryfrag) y ya. La variante influye solo antes, vía `statBoost`, y el rol solo
en composición del mazo. **No hay que tocar el motor de combate, y este bloque no lo tocará.**

## 1.8 El admin que ya existe

| Ruta | Qué hace | Persistencia |
|---|---|---|
| `/admin` | editor de roster: importar, editar, borrar, regenerar stats | **`localStorage`** (`useRosterStore`) |
| `/admin/card-review` | dashboard de la última generación | **`localStorage`** (`useReviewStore`, `useEditorialStore`) |
| `/admin/data-engine`, `/live`, `/torneos`, `/operations`, `/releases`, `/assets`, `/control`, `/tournament-control` | otros dominios | varía |

Y existe un **pipeline editorial completo** en `src/card-generator/`, `src/catalog-builder/`,
`src/editorial/`, `src/review/`, `src/publisher/` — con estados `draft · review · approved ·
published · archived · rejected · hidden`, transacción de publicación
(`PREPARING → VALIDATING → PUBLISHING → COMPLETED | ROLLED_BACK`), validación de runtime,
fingerprints, rollback e invalidación de caches.

**Está muy bien hecho. Y no persiste nada.**

Comprobado: **cero** referencias a Supabase/`createClient`/`from(` en los cinco módulos. El
`publish()` termina llamando a `rebuildCatalog(players)`, que reasigna el `let CARDS` **del proceso
que ejecuta ese código** — que en el admin es **el navegador**.

De ahí la conclusión del §0:

```
Admin edita  →  localStorage del navegador  →  rebuildCatalog() en el CLIENTE
                                                        │
                                                        ✗ el servidor Node nunca se entera
                                                        ✗ se pierde al recargar
                                                        ✗ otro admin no lo ve
                                                        ✗ con 2 instancias, 2 catálogos distintos
```

Mientras tanto el servidor abre sobres con `runtimePackEngine()`, construido sobre el `CARDS` que
se derivó de la semilla al arrancar el proceso. **Siempre el catálogo semilla.**

## 1.9 Seguridad

Lo que está **bien**:

- `verifyAdmin(req)` resuelve el Bearer contra GoTrue y comprueba `profiles.is_admin` con
  `service_role`. Correcto y reutilizable.
- `user_cards`: RLS activo, `select` solo de lo propio, `revoke insert/update/delete` a
  `anon, authenticated`. Toda mutación pasa por RPC `app_*`.
- `card_reference`: RLS con solo política de lectura.
- Las 4 APIs de `/api/admin/*` llaman a `verifyAdmin`.

Lo que **no** está bien — hallazgo de esta auditoría:

> **V-1 · Las páginas `/admin/*` no comprueban `is_admin`.** Se protegen únicamente con
> `ADMIN_ENABLED`, que es `process.env.NEXT_PUBLIC_ADMIN === "1" || NODE_ENV !== "production"`:
> una constante **pública de cliente**. No hay `middleware.ts`. En desarrollo está siempre abierta;
> en producción, con la variable puesta, **cualquiera puede cargar la interfaz de administración**.
> Hoy el daño está acotado porque las APIs sí verifican y el editor de roster solo escribe en el
> `localStorage` del propio curioso. En cuanto el panel de cartas escriba de verdad, esto pasa a ser
> **P0**.

---

# FASE 2 — LAS 17 PREGUNTAS

**1 · ¿Cuál es hoy la fuente de verdad de una carta?**
`src/data/players.ts` + `src/domain/cards/variants.ts`, combinados por `cardsForPlayer()`. Una
carta no se almacena: se calcula.

**2 · ¿Código, base de datos o ambos?**
**Código, en exclusiva.** La BD solo guarda *punteros* (`user_cards.card_id`) y una *proyección*
opcional (`card_reference`, hoy vacía). No hay ni una fila que defina una carta.

**3 · ¿Qué habría que convertir en datos administrables?**
El **roster** (jugadores, métricas, palmarés) y la **existencia de cada carta** con su estado de
publicación. Y la **distribución** (sobres, pools, pesos). **No** las variantes ni los buckets de
rareza: son reglas del juego, no contenido (ver §Fase 11).

**4 · ¿Qué tablas existentes se reutilizan?**
`user_cards`, `card_mints`, `card_reference`, `card_price_stats`, `market_listings`, `duel_decks`,
`profiles.is_admin`. **Ninguna se modifica de forma destructiva**; a `user_cards` solo se le
**añade** una columna nullable.

**5 · ¿Qué tablas nuevas hacen falta?**
Las de §Fase 3. Ninguna sustituye a una existente.

**6 · DEFINITION vs VARIANT vs INSTANCE**

| | Qué es | Identidad | Dónde vive hoy | Dónde debe vivir |
|---|---|---|---|---|
| **Variant** | regla de juego: rank, statBoost, serialLimit, paleta, animación | `VariantId` (unión TS) | código (37) | **código** (v1) |
| **Definition** | *este jugador con esta variante existe en el juego* | `playerId__variantId` | derivada, efímera | **BD, fila real** |
| **Instance** | *este usuario posee este ejemplar* | `uid` uuid | `user_cards` | igual + versión acuñada |

**7 · ¿Qué ocurre al generar una instancia?**
`openPack()` **decide** (no acuña) → `Minter` asigna serial con `nextSerial(variant, minted)`
respetando `serialLimit` → la RPC `app_open_pack` persiste atómicamente: cobra, consume el sobre,
inserta en `user_cards`, incrementa `card_mints`, mueve el pity. Idempotente por clave de gesto.

**8 · ¿Y si un admin modifica una carta que ya poseen 500 usuarios?**
Hoy: **las 500 cambian retroactivamente** —stats, OVR, valor de mercado, desguace, banda
antifraude— sin registro y sin aviso. Las partidas ya jugadas se salvan porque el duelo congela su
propio snapshot. **Esto es el riesgo número uno del bloque** y la propuesta lo cierra por diseño.

**9 · ¿Qué debe quedar congelado en una instancia?**
`uid`, `card_id`, `serial`, `origin`, `obtained_at`, propietario — y **la versión de definición bajo
la que se acuñó**. Deliberadamente **no** una copia de las stats: el duelo ya congela stats por
partida y el mercado tasa contra la definición viva; duplicarlas crearía una segunda fuente de
verdad que acabaría divergiendo.

**10 · ¿Cómo evitar que editar una definición rompa cartas existentes?**
Regla dura: **una definición PUBLICADA es inmutable en lo que afecta al juego** (variante, OVR,
combat, statBoost, rareza, serialLimit). Lo cosmético (nombre, descripción, arte) se edita libre.
Cambiar lo inmutable exige o una carta/variante nueva, o una operación de *re-anclaje* explícita,
auditada y que sube `definition_version` — nunca un `UPDATE` silencioso.

**11 · Carta ↔ jugador**
`content_cards.player_id → content_players.id`, con FK real (hoy no hay ninguna). Y hay que decidir
qué pasa con la tabla `players` del mundo esports: **se deja en paz**, son dominios distintos; se
podrá enlazar opcionalmente más adelante.

**12 · Carta ↔ equipo**
Hoy el equipo es un **campo de texto del jugador** (`player.team`, `player.teamTag`), no una
relación. Existe `public.teams` (24 filas) pero solo la usa el lado esports. Recomendación v1:
el equipo sigue siendo atributo del jugador; enlazarlo a `teams` es un bloque aparte.

**13 · Carta ↔ temporada / evento**
Hoy no existe relación: `PackDef.eventId` y `PackDef.season` marcan el **sobre**, no la carta. La
propuesta lo pone en la definición (`season_id`, `event_id`) y en la disponibilidad.

**14 · Carta ↔ rareza**
Indirecta y en dos saltos: `card.variantId → variant.rank → bucketForRank(rank) → bucket`. La carta
**no tiene** campo rareza. Propuesta: materializar `rarity_rank` y `rarity_bucket` en la fila
(derivados, no editables a mano) para poder indexar y consultar sin recorrer el catálogo.

**15 · Carta ↔ variante**
Es *la mitad de su identidad*: el `cardId` **es** `playerId__variantId`. Por eso una carta no puede
cambiar de variante: sería otra carta.

**16 · Carta ↔ sobre**
Hoy **no hay relación explícita**: la pertenencia se *deduce* evaluando las restricciones del sobre
contra todo el catálogo (`isEligible`). Funciona, pero es imposible de administrar y de consultar
(«¿en qué sobres sale esta carta?» hoy solo se responde recorriendo los 13 sobres).

**17 · ¿Dónde debe vivir la probabilidad?** → §Fase 7. Respuesta corta: **en el pool, no en la
carta**. `card.dropChance = 3` es un modelo incorrecto y explico por qué.

---

# FASE 3 — MODELO PROPUESTO

## 3.1 El principio

> **La generación se conserva; la existencia se persiste.**

No se sustituye `cardsForPlayer()` por una tabla escrita a mano —eso perdería el determinismo, la
trazabilidad a métricas reales y la coherencia matemática que costó varios bloques—. Lo que se hace
es **materializar su resultado** en filas reales, generadas **por la misma función de dominio**, y
darles estado, versión y propiedad administrable.

```
content_players ──cardsForPlayer()──► content_cards ──proyección──► card_reference
   (dato admin)     (dominio, intacto)   (fila real,              (espejo existente
                                          con estado)              del mercado)
```

## 3.2 Tablas nuevas

**`content_players`** — el roster, migrado desde `src/data/players.ts` (379 filas).
`id`, `nick`, `full_name`, `team`, `team_tag`, `region`, `role`, `country`, `image`, `status`,
`stats jsonb`, `metrics jsonb`, `editorial jsonb`, `accolades text[]`, `lifecycle`, auditoría.

**`content_cards`** — **la fila que hoy no existe**. Una por definición.
`card_id` PK (`playerId__variantId`), `player_id` FK, `variant_id`,
`ovr`, `combat jsonb`, `stats jsonb`, `stat_boost`, `rarity_rank`, `rarity_bucket`,
`data_version`, `source`, `season_id`, `event_id`,
`lifecycle`, `definition_version int`, `published_at`, `retired_at`, `checksum`, auditoría.
Los campos derivados los escribe **solo** el generador; el admin no los teclea.

**`content_pools`** — conjunto elegible con nombre.
`id`, `name`, `mode` (`RULE` | `EXPLICIT` | `MIXED`), `rules jsonb` (grupos, regiones, variantes,
series, serializadas — el mismo vocabulario que ya entiende `isEligible`), `lifecycle`.

**`content_pool_entries`** — la pertenencia explícita **y el peso por carta**.
`pool_id`, `card_id`, `weight numeric not null default 1 check (weight > 0)`, `mode`
(`INCLUDE` | `EXCLUDE` | `GUARANTEE`). PK `(pool_id, card_id)` ⇒ duplicados imposibles por esquema.

**`content_packs`** — los 13 sobres como filas: precio, `card_count`, `bucket_weights jsonb`,
`guarantees jsonb`, `pity jsonb`, `anti_duplicate`, `kind`, `retired`, `event_id`, `lifecycle`.

**`content_pack_pools`** — sobre ↔ pool, con `slot_rule jsonb` (a qué huecos/buckets aplica).

**`content_publications`** — el diario de a bordo: quién publicó/retiró qué, cuándo, desde qué
versión, con qué motivo. Append-only. Es lo que hace auditable el plano de control.

**`content_catalog_version`** — una fila, un entero. Se incrementa en cada publicación. Es la señal
barata que permite a cada proceso saber si su catálogo en memoria caducó (§Fase 14).

## 3.3 Cambio en tabla existente (único, y aditivo)

```sql
alter table public.user_cards
  add column if not exists minted_definition_version int;   -- nullable; NULL = pre-migración
```

Nada más. Sin `NOT NULL`, sin backfill destructivo, sin tocar índices existentes.

## 3.4 Lo que el modelo permite

| Requisito | Cómo |
|---|---|
| cartas permanentes | `lifecycle = PUBLISHED`, sin ventana |
| cartas temporales / eventos / temporadas | `event_id` / `season_id` + ventana de disponibilidad |
| cartas retiradas | `RETIRED`: fuera de pools nuevos, instancias intactas |
| cartas futuras | `DRAFT`/`APPROVED` + `available_from` |
| pools y sobres específicos | `content_pools` + `content_pack_pools` |
| probabilidades distintas | `bucket_weights` (sobre) × `weight` (entrada de pool) |
| elegibilidad por reglas | `content_pools.rules`, mismo vocabulario que hoy |
| garantizadas / excluidas | `content_pool_entries.mode` |
| **cambios sin deploy** | todo lo anterior es una fila, no un `git push` |

---

# FASE 4 — CICLO DE VIDA

Reutilizo el vocabulario que **ya existe** en `src/editorial/types.ts` en lugar de inventar otro, y
le cambio el almacenamiento (de `localStorage` a BD).

```
DRAFT ──► REVIEW ──► APPROVED ──► PUBLISHED ──► RETIRED
  │         │            │                          │
  └── ARCHIVED ◄─────────┘                     (nunca se borra)
            REJECTED
```

| Estado | Visible en juego | Qué puede el admin |
|---|---|---|
| `DRAFT` | **no** | editar **todo**, borrar |
| `REVIEW` | no | editar; enviar a aprobar o rechazar |
| `APPROVED` | no | publicar; devolver a draft |
| `PUBLISHED` | **sí** | editar **solo lo cosmético**; retirar; re-anclar (auditado) |
| `RETIRED` | catálogo/colección **sí**; sobres nuevos **no** | re-publicar; archivar |
| `ARCHIVED` / `REJECTED` | no | reabrir a draft |

**Qué garantiza `RETIRED`** (y el verificador tendrá que demostrarlo, no afirmarlo):
no destruye instancias · no rompe la colección · no rompe mazos · no rompe partidas históricas ·
no rompe listados del mercado · sigue tasando · deja de entrar en sorteos nuevos.

Precedente que respalda el diseño: el sobre `prime` ya está `retired: true` con este razonamiento
escrito en `src/data/packs.ts` («no se borra… hay recompensas que conceden sobres Prime y hay
jugadores con sobres sin abrir»). El modelo formaliza lo que el proyecto ya decidió a mano.

---

# FASE 5 — VERSIONADO

Pides seguridad + integridad + **simplicidad**, y evitar complejidad innecesaria. Por eso
**descarto** un versionado completo con tabla de revisiones y cartas apuntando a versión N.

Propuesta mínima que resuelve el problema real:

1. `content_cards.definition_version` — entero, arranca en 1.
2. Sube **solo** cuando cambia algo que afecta al juego (OVR, combat, statBoost, rareza, serialLimit).
   Lo cosmético no lo toca.
3. `user_cards.minted_definition_version` — bajo qué versión se acuñó cada ejemplar.
4. `content_publications` — el histórico completo de qué cambió, quién y por qué.

Con eso se responde «¿esta carta es la misma que cuando la conseguí?» sin duplicar el catálogo por
versión. Y como **publicado es inmutable en lo relevante**, el caso normal es que
`definition_version` nunca se mueva: existe para el caso excepcional y auditado, no para el diario.

---

# FASE 6 — ADMIN UX (diseño, sin implementar)

```
/admin/cartas             listado: buscador + facetas (jugador, variante, rareza, OVR,
                          estado, temporada, evento, pools) + acciones en lote
/admin/cartas/nueva       alta: elegir jugador → elegir variante → previsualizar → guardar draft
/admin/cartas/[id]        ficha
/admin/cartas/[id]/editar edición según estado
/admin/pools              pools y pesos
/admin/sobres             sobres y su composición
```

Ficha, en cinco bloques (los que pides): **Identidad** · **Carta** · **Economía** ·
**Distribución** · **Publicación**.

**Preview**: el requisito de «exactamente el mismo componente visual que usa el juego» es
alcanzable — hay que reutilizar el componente de carta existente. Queda por confirmar cuál es el
canónico (`src/components/cards/*` y `src/cardviewer/*` son candidatos); es lo primero que miraré
al implementar, y **no** se hará un render paralelo.

Regla transversal: **la UI no calcula nada.** Ni probabilidad, ni OVR, ni valor. Todo lo sirve el
servidor, igual que en los bloques PvP.

---

# FASE 7 — PROBABILIDADES

## 7.1 Por qué `card.dropChance = 3` es el modelo equivocado

Pediste estudiarlo, y la respuesta es que **no funciona**, por cuatro razones concretas:

1. **No suma 1.** 772 cartas con su porcentaje suelto no forman una distribución; forman un
   conjunto de números que hay que renormalizar — y entonces el número que el admin escribió deja
   de significar lo que parece.
2. **Depende del contexto.** La misma carta sale en el Estándar, el Premium y el EMEA. Un solo
   número no puede ser correcto en los tres.
3. **Se rompe al añadir contenido.** Publicar la carta 773 cambia la probabilidad real de las 772
   anteriores sin que nadie haya tocado sus valores.
4. **Es incompatible con lo ya construido**: garantías por hueco, pity y anti-duplicados operan
   sobre *buckets* y *pools*, no sobre porcentajes por carta.

## 7.2 El modelo correcto

Exactamente la arquitectura que apuntabas, con la capa de peso añadida donde falta:

```
PACK           bucket_weights: {common:55, uncommon:35, rare:8, epic:1.8, legendary:0.2}
  ↓            (renormalizados sobre los buckets CON STOCK — ya lo hace el motor)
POOL           reglas + entradas explícitas
  ↓
BUCKET         bucketForRank(variant.rank)
  ↓
ELIGIBLE       cartas PUBLICADAS del pool en ese bucket
  ↓
WEIGHT         content_pool_entries.weight   ← LA PIEZA NUEVA
```

```
P(carta) = P(bucket) × weight(carta) / Σ weight(cartas del bucket en el pool)
```

## 7.3 La propiedad que hace segura la migración

> **Con `weight = 1` para todas las cartas, la fórmula se reduce a la uniforme actual.**

Es decir: el modelo nuevo es una **generalización estricta** del vigente. Migrar con el peso por
defecto **no cambia ni una probabilidad**, y eso es demostrable numéricamente — igual que en el
bloque 7.4.1 se validó la fórmula Elo en SQL contra el oráculo en TypeScript.

## 7.4 Cómo se calcula la probabilidad efectiva

Honestamente: `guaranteedMin`, `guarantees[]` y `pity` hacen que la probabilidad **no** sea uniforme
entre huecos. Cada hueco tiene su propio `minIdx`. Por eso:

- se calcula **analíticamente por hueco** (cada uno con su restricción) y se agrega a
  «probabilidad de que la carta salga al menos una vez» y «copias esperadas por sobre»;
- se **contrasta con Monte Carlo ejecutando el motor real** `openPack()`, no una reimplementación.
  Si el cálculo y el motor discrepan, el que está mal es el cálculo.
- el pity depende del historial del jugador, así que se reporta como escenario («sin pity» /
  «con pity a punto»), nunca como un número único que finja certeza.

Todo **en el servidor**. La UI muestra; no calcula.

## 7.5 Validaciones exigidas

`weight > 0` (CHECK) · pool no vacío por bucket con peso > 0 · solo cartas `PUBLISHED` entran en
sorteo · duplicados imposibles (PK) · **sobre que anuncia un bucket sin stock** (el caso real del
Sobre China, ya documentado en el código) · suma de garantías ≤ `card_count` · pool sin ninguna
carta elegible.

---

# FASE 8 — SEGURIDAD

1. **`content_*`: RLS activo, cero políticas de cliente, `revoke all` a `anon, authenticated`.**
   Mismo patrón que las tablas PvP. Ni leer.
2. **Toda escritura por RPC `security definer` concedida solo a `service_role`**, invocada desde
   rutas de servidor tras `verifyAdmin(req)`.
3. **`userId` y `is_admin` salen del Bearer**, jamás del cuerpo ni de la query. Nunca se confía en
   `role`, `userId` ni `admin=true` enviados por el cliente.
4. **Cerrar V-1**: las páginas `/admin/*` deben comprobar `is_admin` en servidor, no solo
   `ADMIN_ENABLED`. Es la única corrección de seguridad que este bloque debe hacer sí o sí.
5. Lectura pública **solo** de lo publicado, y por una proyección, nunca por la tabla de trabajo.

---

# FASE 9 — INTEGRACIÓN REAL

La condición de aceptación es que publicar entre de verdad en el juego. La cadena propuesta:

```
admin publica  →  RPC valida y marca PUBLISHED  →  content_catalog_version++
                                                          │
        servidor: ¿mi catálogo está en la versión vigente? ─┴─ no → recargar (una query)
                                                                │
                   registry → PackEngine → openPack → Minter → user_cards
                                                                │
                          catálogo · colección · inventario · mazo · duelo
```

**Sin `rebuildCatalog` desde el navegador. Sin tocar código para añadir una carta.**

---

# FASE 10 — DATOS EXISTENTES

Migración generadora, no destructiva:

1. `content_players` ← los 379 de `src/data/players.ts`.
2. `content_cards` ← `cardsForPlayer()` sobre esos 379, **la misma función**, todas en `PUBLISHED`
   (son las que ya están en el juego).
3. `content_packs` / `content_pools` / `content_pool_entries` ← los 13 sobres, con `weight = 1`.

**Comprobación ANTES vs DESPUÉS, obligatoria y automática:**

| Invariante | Esperado |
|---|---|
| jugadores | 379 = 379 |
| cartas | **772 = 772**, mismos ids exactos |
| cada `user_cards.card_id` resuelve | 100 % |
| cada uid de `duel_decks.card_uids` resuelve | 100 % |
| cada `market_listings.card_id` resuelve | 100 % |
| `card_mints` intacta, seriales intactos | sí |
| OVR/combat por carta idénticos | diferencia **0** |
| probabilidad de cada carta en cada sobre | diferencia **0** |
| propiedad, mazos, mercado, partidas | sin cambios |

Si cualquiera falla, la migración no se da por buena. Reversible: las `content_*` se pueden borrar
sin tocar una sola fila de las tablas de juego, porque el catálogo derivado sigue existiendo en
código durante la transición.

---

# FASE 11 — AUDITORÍA DE HARD-CODE

| Qué | Dónde | Clasificación |
|---|---|---|
| 379 jugadores | `src/data/players.ts` | **MIGRATE** → `content_players` |
| Derivación de cartas | `src/data/catalog.ts` | **KEEP** — es el generador, no contenido |
| 37 variantes (rank, boost, serialLimit, paleta) | `src/domain/cards/variants.ts` | **KEEP** (v1) — regla de juego; `VariantId` es una unión de tipos usada en todo el código |
| 5 buckets de rareza | 52 sitios (craft, artwork, UI, tipos) | **KEEP** — eje estructural del juego, no contenido |
| 13 sobres con pesos y restricciones | `src/data/packs.ts` | **MIGRATE** → `content_packs` |
| `weights` por bucket | `src/data/packs.ts` | **MIGRATE** |
| Pools implícitos (`restrictGroups`, `restrictRegion`, `series`…) | `PackDef` | **MIGRATE** → `content_pools.rules` |
| 3 cardIds en recompensas de evento | `src/data/events.ts:45,62,79` | **MIGRATE** (referencia a contenido) |
| 3 cardIds en un logro | `src/domain/progression/achievements.ts:81` | **LEGACY** — documentar; romperlo cambiaría un logro ya conseguido |
| `rebuildCatalog()` desde el cliente | `useRosterStore`, `publisher/catalog.ts` | **REMOVE** al final — **solo tras demostrar que nadie depende de él** |
| Pipeline editorial en `localStorage` | `src/editorial/store.ts`, `src/review/store.ts` | **MIGRATE** (lógica **KEEP**, almacenamiento **REMOVE**) |
| Fórmulas de economía | `pricing.ts`, `salvage.ts` | **KEEP** — no se toca la economía |
| `CATALOG_GENERATED_AT` fija | `src/data/catalog.ts:13` | **KEEP** — determinismo deliberado |

Nada se borra en este bloque sin prueba de que ya no se usa.

---

# HALLAZGOS, CLASIFICADOS

| id | hallazgo | prioridad |
|---|---|---|
| **H-1** | El panel de administración de cartas **no administra nada real**: `localStorage` + singleton por proceso. El servidor nunca ve los cambios. | **P0** para el objetivo del bloque |
| **H-2** | Editar una definición **muta retroactivamente** stats, OVR, valor y desguace de todas las instancias ya poseídas. Sin versión, sin registro, sin aviso. | **P0** de integridad |
| **V-1** | `/admin/*` se protege solo con `ADMIN_ENABLED` (constante pública de cliente). Sin `middleware.ts`, sin `is_admin` en la página. | **P1** hoy · **P0** en cuanto el panel escriba |
| **H-3** | No existe peso por carta: dentro de un bucket el sorteo es uniforme. Imposible destacar o rebajar una carta. | **P1** |
| **H-4** | La pertenencia carta↔sobre es **deducida**, no declarada. «¿En qué sobres sale esta carta?» no se puede consultar. | **P1** |
| **H-5** | `user_cards.card_id` sin FK ni validación: nada impide una instancia huérfana apuntando a una carta inexistente. | **P2** |
| **H-6** | Dos conceptos de «jugador» sin relación (`src/data/players.ts` 379 vs tabla `players` 84). Confunde y duplica. | **P2** |
| **H-7** | 12 variantes definidas y vacías: capacidad instalada sin forma de usarla sin tocar código. | **P2** |
| **H-8** | `card_reference` está a **0 filas** en local: la banda antifraude del mercado opera sin ancla. | **P2** |
| **H-9** | El pipeline editorial (5 módulos, muy trabajado) no persiste nada: su valor real hoy es cero. | **P3** |

---

# LO QUE PROPONGO HACER, Y EN QUÉ ORDEN

Este bloque, tal y como está redactado, es **grande**: son 5 subsistemas nuevos (definiciones,
pools, sobres, publicación, panel) más una migración de 772 cartas. Siguiendo el método que ya
funcionó en los bloques 7.4 → 7.6, propongo **partirlo** y entregar cada parte verificada:

| | Alcance | Entregable |
|---|---|---|
| **8.1** | Cimiento: `content_players` + `content_cards` + migración con la comprobación antes/después + lectura del catálogo desde BD en el servidor + cerrar **V-1** | el catálogo deja de vivir solo en código, y nada cambia para el jugador |
| **8.2** | Ciclo de vida + `definition_version` + `minted_definition_version` + inmutabilidad de lo publicado | **H-2 cerrado**: editar deja de poder romper cartas ajenas |
| **8.3** | Pools, sobres y pesos, con la prueba de probabilidad idéntica | **H-3 y H-4 cerrados** |
| **8.4** | El panel `/admin/cartas` completo + preview con el componente real + QA end-to-end | el criterio READY del encargo |

Si prefieres que lo aborde de una sola vez, lo hago — pero quiero decirte antes que el riesgo de
integridad se concentra en 8.1 y 8.2, y que verificarlos por separado es lo que hace que los 772
ids, las 53 instancias, el mazo, el listado de mercado y las 4 partidas sigan exactamente donde
están.

**Nada de esto está implementado. No he tocado ni una línea de código de producción, ni la base de
datos, ni he hecho commit.**
